import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {WebView} from 'react-native-webview';
import Geolocation from 'react-native-geolocation-service';
import firestore from '@react-native-firebase/firestore';
import {getActiveSessionId} from '../services/locationService';
import {useFocusEffect} from '@react-navigation/native';

const {width, height} = Dimensions.get('window');

function MapScreen({route, navigation}) {
  const {worker, territory} = route.params || {};
  const [loading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locationTrail, setLocationTrail] = useState([]);
  const [territoryBoundary, setTerritoryBoundary] = useState(null);
  const [mapHTML, setMapHTML] = useState('');
  const webViewRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const gpsWatchIdRef = useRef(null);

  useEffect(() => {
    console.log('MapScreen mounted');
    initializeMap();

    return () => {
      // Cleanup listener when component unmounts
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        console.log('🛑 Unsubscribed from location listener');
      }
      
      // Cleanup GPS watch
      if (gpsWatchIdRef.current) {
        Geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
        console.log('🛑 GPS watch cleared');
      }
    };
  }, []);

  // Pokreni GPS watch kad se screen otvori (focus)
  useFocusEffect(
    useCallback(() => {
      console.log('📍 Screen focused - starting GPS watch');
      startGPSWatch();

      return () => {
        // Zaustavi watch kad se ode sa screena (blur)
        if (gpsWatchIdRef.current) {
          Geolocation.clearWatch(gpsWatchIdRef.current);
          gpsWatchIdRef.current = null;
          console.log('🛑 GPS watch stopped (screen blur)');
        }
      };
    }, [])
  );

  const initializeMap = async () => {
    const location = await getCurrentLocation();
    const trail = await loadLocationHistory();
    const boundary = territory ? await loadTerritoryBoundary() : null;

    setCurrentLocation(location);
    setLocationTrail(trail);
    setTerritoryBoundary(boundary);

    generateAndSetMapHTML(location, trail, boundary);
    setLoading(false);

    // Start listening for new points
    setupLocationListener();
  };

  const getCurrentLocation = () => {
    return new Promise(resolve => {
      Geolocation.getCurrentPosition(
        position => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          console.log('📍 Current location:', location);
          resolve(location);
        },
        error => {
          console.error('❌ Get current location error:', error);
          Alert.alert('Greška', 'Ne mogu dohvatiti trenutnu lokaciju.');
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        },
      );
    });
  };

  const loadTerritoryBoundary = async () => {
    if (!territory || !territory.id) return null;

    try {
      const doc = await firestore()
        .collection('territories')
        .doc(territory.id)
        .get();

      if (doc.exists) {
        const data = doc.data();
        if (data.boundaryGeoJSON) {
          const geoJSON = JSON.parse(data.boundaryGeoJSON);
          const coordinates = geoJSON.coordinates[0].map(coord => [
            coord[1],
            coord[0],
          ]);
          console.log('🗺️ Territory loaded:', coordinates.length, 'points');
          return coordinates;
        }
      }
    } catch (error) {
      console.error('❌ Error loading territory:', error);
    }
    return null;
  };

  const loadLocationHistory = async () => {
    try {
      const sessionId = await getActiveSessionId();
      if (!sessionId) {
        console.log('⚠️ No active session');
        return [];
      }

      const snapshot = await firestore()
        .collection('locations')
        .doc(sessionId)
        .collection('points')
        .orderBy('timestampMs', 'asc')
        .get();

      const points = snapshot.docs.map(doc => {
        const data = doc.data();
        return [data.latitude, data.longitude];
      });

      console.log('📍 Trail loaded:', points.length, 'points');
      return points;
    } catch (error) {
      console.error('❌ Error loading location history:', error);
      return [];
    }
  };

  // Pokreni GPS watch za ažuriranje trenutne lokacije
  const startGPSWatch = () => {
    console.log('📍 Starting GPS watch for current location marker...');
    
    gpsWatchIdRef.current = Geolocation.watchPosition(
      position => {
        const newLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        
        console.log(`📍 Current marker update: ${newLocation.latitude.toFixed(6)}, ${newLocation.longitude.toFixed(6)}`);
        
        // Update state
        setCurrentLocation(newLocation);
        
        // Update zeleni marker na mapi
        updateCurrentMarker(newLocation);
      },
      error => {
        console.error('❌ GPS watch error:', error);
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 5, // Update samo ako se pomakneš 5+ metara
        interval: 3000, // Svake 3 sekunde
        fastestInterval: 3000,
      }
    );
  };

  // Ažuriraj zeleni marker (trenutna lokacija)
  const updateCurrentMarker = location => {
    if (!webViewRef.current || !location) return;

    const jsCode = `
      if (window.currentMarker) {
        map.removeLayer(window.currentMarker);
      }
      
      window.currentMarker = L.marker([${location.latitude}, ${location.longitude}], {
        icon: L.divIcon({
          className: 'custom-marker',
          html: '<div style="background: #10B981; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.3);"></div>',
          iconSize: [20, 20]
        })
      }).addTo(map);
      
      true;
    `;

    webViewRef.current.injectJavaScript(jsCode);
  };

  // Real-time listener za nove točke
  const setupLocationListener = async () => {
    try {
      const sessionId = await getActiveSessionId();
      if (!sessionId) {
        console.log('⚠️ No active session for listener');
        return;
      }

      console.log('👂 Setting up real-time location listener...');

      unsubscribeRef.current = firestore()
        .collection('locations')
        .doc(sessionId)
        .collection('points')
        .orderBy('timestampMs', 'desc')
        .limit(20) //samo zadnjih 20 točaka (za performance)
        .onSnapshot(
          snapshot => {
            if (snapshot.empty) return;

            const newPoints = [];
            snapshot.forEach(doc => {
              const data = doc.data();
              newPoints.push([data.latitude, data.longitude]);
            });

            newPoints.reverse();

            setLocationTrail(prevTrail => {
              const updatedTrail = [...prevTrail, ...newPoints];
              console.log(`📍 Trail updated: ${updatedTrail.length} points`);

              updateMapTrail(updatedTrail);

              return updatedTrail;
            });
          },
          error => {
            console.error('❌ Listener error:', error);
          },
        );
    } catch (error) {
      console.error('❌ Error setting up listener:', error);
    }
  };

  const updateMapTrail = trail => {
    if (!webViewRef.current || trail.length === 0) return;

    const trailJSON = JSON.stringify(trail);

    const jsCode = `
      if (window.trailLayer) {
        map.removeLayer(window.trailLayer);
      }
      
      var trail = ${trailJSON};
      
      if (trail.length > 1) {
        window.trailLayer = L.polyline(trail, {
          color: '#EF4444',
          weight: 4
        }).addTo(map);
      }
      
      true;
    `;

    webViewRef.current.injectJavaScript(jsCode);
  };

  const generateAndSetMapHTML = (location, trail, boundary) => {
    const center = location || {
      latitude: 43.5081,
      longitude: 16.4402,
    };

    const boundaryJSON = boundary ? JSON.stringify(boundary) : '[]';
    const trailJSON = trail.length > 0 ? JSON.stringify(trail) : '[]';
    const currentJSON = location
      ? JSON.stringify([location.latitude, location.longitude])
      : 'null';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body { margin: 0; padding: 0; }
    #map { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map').setView([${center.latitude}, ${center.longitude}], 15);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    var allBounds = [];
    var trailLayer = null;

    // Territory boundary
    var boundary = ${boundaryJSON};
    if (boundary.length > 0) {
      L.polygon(boundary, {
        color: '#10B981',
        fillColor: '#10B981',
        fillOpacity: 0.2,
        weight: 3
      }).addTo(map);
      boundary.forEach(point => allBounds.push(point));
    }

    // Initial trail
    var trail = ${trailJSON};
    if (trail.length > 1) {
      window.trailLayer = L.polyline(trail, {
        color: '#EF4444',
        weight: 4
      }).addTo(map);
      trail.forEach(point => allBounds.push(point));
    }

    // Current location marker
    var current = ${currentJSON};
    if (current) {
      window.currentMarker = L.marker(current, {
        icon: L.divIcon({
          className: 'custom-marker',
          html: '<div style="background: #10B981; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.3);"></div>',
          iconSize: [20, 20]
        })
      }).addTo(map);
      allBounds.push(current);
    }

    // Fit bounds
    if (allBounds.length > 0) {
      var bounds = L.latLngBounds(allBounds);
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (current) {
      map.setView(current, 16);
    }
  </script>
</body>
</html>
    `;

    setMapHTML(html);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Učitavam mapu...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.overlay}>
        <View style={styles.infoCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.infoTitle}>
                {territory?.name || 'Bez odabranog terena'}
              </Text>
              <Text style={styles.infoSubtitle}>
                {locationTrail.length} GPS točaka • {worker?.name}
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.centerButton}
              onPress={() => {
                if (currentLocation && webViewRef.current) {
                  const jsCode = `
                    map.setView([${currentLocation.latitude}, ${currentLocation.longitude}], 17);
                    true;
                  `;
                  webViewRef.current.injectJavaScript(jsCode);
                }
              }}>
              <Text style={styles.centerButtonText}>📍</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {mapHTML ? (
        <WebView
          ref={webViewRef}
          source={{html: mapHTML}}
          style={styles.map}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          onLoadEnd={() => {
            console.log('🗺️ WebView loaded - starting GPS watch');
            // Malo delay da se mapa sigurno učita
            setTimeout(() => {
              startGPSWatch();
            }, 500);
          }}
          renderLoading={() => (
            <ActivityIndicator
              size="large"
              color="#10B981"
              style={styles.webviewLoader}
            />
          )}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B7280',
  },
  map: {
    flex: 1,
  },
  webviewLoader: {
    position: 'absolute',
    top: height / 2,
    left: width / 2,
    marginLeft: -20,
    marginTop: -20,
  },
  overlay: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    zIndex: 1000,
  },
  infoCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  infoSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  centerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  centerButtonText: {
    fontSize: 24,
  },
});

export default MapScreen;