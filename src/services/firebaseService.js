import firestore from '@react-native-firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';

export const loginWithPin = async (pin) => {
  try {
    const snapshot = await firestore()
      .collection('workers')
      .where('pin', '==', pin)
      .where('active', '==', true)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return { success: false, error: 'Neispravan PIN' };
    }

    const workerDoc = snapshot.docs[0];
    const workerData = workerDoc.data();
    const deviceId = await DeviceInfo.getUniqueId();

    if (workerData.activeLoginSession) {
      const loginSessionDoc = await firestore()
        .collection('loginSessions')
        .doc(workerData.activeLoginSession)
        .get();
      
      if (loginSessionDoc.exists) {
        const sessionData = loginSessionDoc.data();
        const loginTime = sessionData.loginTime?.toDate();
        
        if (sessionData.deviceId === deviceId) {
          const batch = firestore().batch();
          
          batch.update(
            firestore().collection('loginSessions').doc(workerData.activeLoginSession),
            { active: false, replacedAt: firestore.FieldValue.serverTimestamp() }
          );
          
          batch.update(
            firestore().collection('workers').doc(workerDoc.id),
            { activeLoginSession: null }
          );
          
          await batch.commit();
        } else if (loginTime) {
          const hoursSinceLogin = (Date.now() - loginTime.getTime()) / (1000 * 60 * 60);
          
          if (hoursSinceLogin > 24) {
            const batch = firestore().batch();
            
            batch.update(
              firestore().collection('loginSessions').doc(workerData.activeLoginSession),
              { active: false, expiredAt: firestore.FieldValue.serverTimestamp() }
            );
            
            batch.update(
              firestore().collection('workers').doc(workerDoc.id),
              { activeLoginSession: null }
            );
            
            await batch.commit();
          } else if (sessionData.active === true) {
            return { 
              success: false, 
              error: 'Korisnik već prijavljen na drugom uređaju.' 
            };
          } else {
            await firestore()
              .collection('workers')
              .doc(workerDoc.id)
              .update({ activeLoginSession: null });
          }
        }
      } else {
        await firestore()
          .collection('workers')
          .doc(workerDoc.id)
          .update({ activeLoginSession: null });
      }
    }

    const loginSessionRef = await firestore()
      .collection('loginSessions')
      .add({
        workerId: workerDoc.id,
        workerName: workerData.name,
        loginTime: firestore.FieldValue.serverTimestamp(),
        active: true,
        deviceId: deviceId,
        deviceInfo: {
          platform: Platform.OS,
          version: Platform.Version ? Platform.Version.toString() : 'unknown'
        }
      });

    await firestore()
      .collection('workers')
      .doc(workerDoc.id)
      .update({
        activeLoginSession: loginSessionRef.id
      });

    await AsyncStorage.setItem('activeLoginSession', loginSessionRef.id);
    await AsyncStorage.setItem('loggedInWorkerId', workerDoc.id);

    return { 
      success: true, 
      worker: {
        id: workerDoc.id,
        ...workerData
      }
    };
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, error: 'Greška pri prijavi' };
  }
};

export const logout = async (workerId) => {
  try {
    const loginSessionId = await AsyncStorage.getItem('activeLoginSession');
    const batch = firestore().batch();
    
    if (loginSessionId) {
      batch.update(
        firestore().collection('loginSessions').doc(loginSessionId),
        { active: false, logoutTime: firestore.FieldValue.serverTimestamp() }
      );
    }
    
    if (workerId) {
      batch.update(
        firestore().collection('workers').doc(workerId),
        { activeLoginSession: null }
      );
    }
    
    await batch.commit();
    await AsyncStorage.removeItem('activeLoginSession');
    await AsyncStorage.removeItem('loggedInWorkerId');
    
    return { success: true };
  } catch (error) {
    console.error('Logout error:', error);
    return { success: false, error: 'Greška pri odjavi' };
  }
};

export const getWorkerTerritories = async (workerId) => {
  try {
    const workerDoc = await firestore()
      .collection('workers')
      .doc(workerId)
      .get();

    if (!workerDoc.exists) {
      return [];
    }

    const assignedTerritoryIds = workerDoc.data().assignedTerritories || [];

    if (assignedTerritoryIds.length === 0) {
      return [];
    }

    const territoriesPromises = assignedTerritoryIds.map(id =>
      firestore().collection('territories').doc(id).get()
    );

    const territoryDocs = await Promise.all(territoriesPromises);

    const territories = territoryDocs
      .filter(doc => doc.exists)
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

    return territories;
  } catch (error) {
    console.error('Error fetching territories:', error);
    return [];
  }
};