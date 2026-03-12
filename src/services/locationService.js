import Geolocation from 'react-native-geolocation-service';
import {PermissionsAndroid, Platform, NativeModules} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { getFirestore } from '@react-native-firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { LocationServiceModule } = NativeModules;

let watchId = null;
let uploadInterval = null;
let locationBuffer = [];
let lastValidLocation = null;

const db = getFirestore();

const GPS_INTERVAL = 2000;
const UPLOAD_INTERVAL = 20000;

const MAX_ACCURACY = 35;
const MAX_SPEED_MS = 29;
const MAX_DISTANCE_JUMP = 70;

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function isValidGPSPoint(newLocation, previousLocation) {
  if (newLocation.accuracy > MAX_ACCURACY) {
    console.log(`[FILTER] Rejected - Poor accuracy: ${newLocation.accuracy.toFixed(1)}m`);
    return false;
  }

  if (!previousLocation) {
    return true;
  }

  const distance = calculateDistance(
    previousLocation.latitude,
    previousLocation.longitude,
    newLocation.latitude,
    newLocation.longitude
  );

  const timeDiff = (newLocation.timestampMs - previousLocation.timestampMs) / 1000;

  if (timeDiff <= 0) {
    console.log('[FILTER] Rejected - Invalid time');
    return false;
  }

  const calculatedSpeed = distance / timeDiff;

  if (calculatedSpeed > MAX_SPEED_MS) {
    console.log(`[FILTER] Rejected - Speed too high: ${calculatedSpeed.toFixed(1)} m/s (${(calculatedSpeed * 3.6).toFixed(1)} km/h)`);
    return false;
  }

  if (distance > MAX_DISTANCE_JUMP && timeDiff < 5) {
    console.log(`[FILTER] Rejected - Distance jump: ${distance.toFixed(1)}m in ${timeDiff.toFixed(1)}s`);
    return false;
  }

  return true;
}

export const requestLocationPermission = async () => {
  if (Platform.OS === 'ios') {
    return true;
  }

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Prizma Tracker - Dozvola za lokaciju',
        message: 'Aplikacija treba pristup lokaciji za praćenje kretanja.',
        buttonNeutral: 'Pitaj me kasnije',
        buttonNegative: 'Odbij',
        buttonPositive: 'Dozvoli',
      },
    );

    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      if (Platform.Version >= 29) {
        const bgGranted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
          {
            title: 'Prizma Tracker - Lokacija u pozadini',
            message:
              'Aplikacija treba pristup lokaciji u pozadini za kontinuirano praćenje.',
            buttonNeutral: 'Pitaj me kasnije',
            buttonNegative: 'Odbij',
            buttonPositive: 'Dozvoli',
          },
        );
        
        if (bgGranted !== PermissionsAndroid.RESULTS.GRANTED) {
          console.warn('Background location permission denied');
        }
      }
      
      if (Platform.Version >= 33) {
        const notifGranted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Prizma Tracker - Obavijesti',
            message: 'Aplikacija treba dozvolu za prikaz obavijesti tijekom trackinga.',
            buttonNeutral: 'Pitaj me kasnije',
            buttonNegative: 'Odbij',
            buttonPositive: 'Dozvoli',
          },
        );
        
        if (notifGranted !== PermissionsAndroid.RESULTS.GRANTED) {
          console.warn('Notification permission denied');
        }
      }
      
      return true;
    }
    return false;
  } catch (err) {
    console.warn('Permission error:', err);
    return false;
  }
};

export const startTracking = async (
  workerId,
  workerName,
  territoryId = null,
  flyerCount = null,
) => {
  try {
    console.log('Starting tracking...');
    
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      return {success: false, error: 'Location permission denied'};
    }

    const now = new Date();
    
    const sessionRef = await db.collection('sessions').add({
      workerId,
      workerName,
      territoryId,
      flyerCount,
      startTime: now,
      startTimeMs: Date.now(),
      endTime: null,
      status: 'active',
      totalDistance: 0,
      averageSpeed: 0,
      pointsCount: 0,
      lastLocationUpdate: firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('workers').doc(workerId).update({
      activeSessionId: sessionRef.id
    });

    await AsyncStorage.setItem('activeSessionId', sessionRef.id);
    await AsyncStorage.setItem('activeSessionWorkerId', workerId);

    console.log('Tracking session created:', sessionRef.id);

    locationBuffer = [];
    lastValidLocation = null;

    if (LocationServiceModule) {
      console.log('Calling native service...');
      LocationServiceModule.startService(workerName);
      console.log('Native service called');
    } else {
      console.error('LocationServiceModule is null');
    }

    startGPSWatch(sessionRef.id);
    startUploadTimer(sessionRef.id);

    return {success: true, sessionId: sessionRef.id};
  } catch (error) {
    console.error('Error starting tracking:', error);
    return {success: false, error: error.message};
  }
};

const startGPSWatch = sessionId => {
  console.log('Starting GPS watch (every 2s)...');
  let isFirstPoint = true;

  watchId = Geolocation.watchPosition(
    async position => {
      const locationData = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        speed: position.coords.speed || 0,
        accuracy: position.coords.accuracy || 0,
        timestamp: new Date(),
        timestampMs: Date.now(),
      };

      if (isFirstPoint) {
        isFirstPoint = false;
        lastValidLocation = locationData;
        
        console.log('FIRST GPS point - uploading immediately');
        
        try {
          await db
            .collection('locations')
            .doc(sessionId)
            .collection('points')
            .add(locationData);
          
          await db
            .collection('sessions')
            .doc(sessionId)
            .update({
              pointsCount: firestore.FieldValue.increment(1),
              lastLocationUpdate: firestore.FieldValue.serverTimestamp(),
            });
          
          console.log('First point uploaded');
        } catch (error) {
          console.error('Error uploading first point:', error);
        }

        locationBuffer.push(locationData);
        return;
      }

      if (!isValidGPSPoint(locationData, lastValidLocation)) {
        console.log(`[REJECTED] Lat: ${locationData.latitude.toFixed(6)}, Lon: ${locationData.longitude.toFixed(6)}, Acc: ${locationData.accuracy.toFixed(1)}m`);
        return;
      }

      lastValidLocation = locationData;
      locationBuffer.push(locationData);

      console.log(
        `[ACCEPTED] GPS: ${locationData.latitude.toFixed(6)}, ${locationData.longitude.toFixed(6)} | Acc: ${locationData.accuracy.toFixed(1)}m | Buffer: ${locationBuffer.length}`,
      );
    },
    error => {
      console.error('GPS error:', error);
    },
    {
      enableHighAccuracy: true,
      distanceFilter: 5,
      interval: GPS_INTERVAL,
      fastestInterval: GPS_INTERVAL,
      forceRequestLocation: true,
      showLocationDialog: true,
    },
  );
};

const startUploadTimer = sessionId => {
  console.log('Starting upload timer (every 20s)...');

  uploadInterval = setInterval(() => {
    uploadLocationBatch(sessionId);
  }, UPLOAD_INTERVAL);
};

const uploadLocationBatch = async sessionId => {
  if (locationBuffer.length === 0) {
    console.log('Buffer empty');
    return;
  }

  const pointsToUpload = [...locationBuffer];
  locationBuffer = [];

  try {
    const batch = db.batch();
    const locationsRef = db
      .collection('locations')
      .doc(sessionId)
      .collection('points');

    pointsToUpload.forEach(location => {
      const docRef = locationsRef.doc();
      batch.set(docRef, location);
    });

    await batch.commit();

    console.log(`Uploaded ${pointsToUpload.length} locations`);

    await db
      .collection('sessions')
      .doc(sessionId)
      .update({
        pointsCount: firestore.FieldValue.increment(pointsToUpload.length),
        lastLocationUpdate: firestore.FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.error('Error uploading batch:', error);
    locationBuffer.unshift(...pointsToUpload);
  }
};

export const stopTracking = async () => {
  try {
    const sessionId = await AsyncStorage.getItem('activeSessionId');
    const workerId = await AsyncStorage.getItem('activeSessionWorkerId');
    
    if (!sessionId) {
      return {success: false, error: 'No active session'};
    }

    if (watchId !== null) {
      Geolocation.clearWatch(watchId);
      watchId = null;
      console.log('GPS watch stopped');
    }

    if (uploadInterval !== null) {
      clearInterval(uploadInterval);
      uploadInterval = null;
      console.log('Upload timer stopped');
    }

    if (LocationServiceModule) {
      LocationServiceModule.stopService();
      console.log('Native service stopped');
    }

    if (locationBuffer.length > 0) {
      console.log(`Uploading final ${locationBuffer.length} points...`);
      await uploadLocationBatch(sessionId);
    }

    const now = new Date();
    await db
      .collection('sessions')
      .doc(sessionId)
      .update({
        endTime: now,
        endTimeMs: Date.now(),
        status: 'completed',
      });

    if (workerId) {
      await db.collection('workers').doc(workerId).update({
        activeSessionId: null
      });
    }

    await AsyncStorage.removeItem('activeSessionId');
    await AsyncStorage.removeItem('activeSessionWorkerId');

    console.log('Tracking stopped');

    lastValidLocation = null;

    return {success: true, sessionId: sessionId};
  } catch (error) {
    console.error('Error stopping tracking:', error);
    return {success: false, error: error.message};
  }
};

export const isTrackingActive = async (workerId) => {
  try {
    const sessionId = await AsyncStorage.getItem('activeSessionId');
    
    if (sessionId) {
      return true;
    }
    
    if (workerId) {
      const workerDoc = await db.collection('workers').doc(workerId).get();
      
      if (workerDoc.exists && workerDoc.data().activeSessionId) {
        const activeSessionId = workerDoc.data().activeSessionId;
        
        const sessionDoc = await db.collection('sessions').doc(activeSessionId).get();
        
        if (sessionDoc.exists && sessionDoc.data().status === 'active') {
          await AsyncStorage.setItem('activeSessionId', activeSessionId);
          await AsyncStorage.setItem('activeSessionWorkerId', workerId);
          
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error checking tracking status:', error);
    return false;
  }
};

export const getActiveSessionId = async () => {
  try {
    return await AsyncStorage.getItem('activeSessionId');
  } catch (error) {
    return null;
  }
};