import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Picker} from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  startTracking,
  stopTracking,
  isTrackingActive,
} from '../services/locationService';
import {getWorkerTerritories} from '../services/firebaseService';
import firestore from '@react-native-firebase/firestore';

function HomeScreen({route, navigation}) {
  const {worker} = route.params;
  const [tracking, setTracking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [territories, setTerritories] = useState([]);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState('');
  const [selectedTerritory, setSelectedTerritory] = useState(null);
  const [selectedFlyerOption, setSelectedFlyerOption] = useState(null);

  useEffect(() => {
    initializeScreen();
  }, []);

  useEffect(() => {
    if (selectedTerritoryId) {
      const territory = territories.find(t => t.id === selectedTerritoryId);
      setSelectedTerritory(territory);
    } else {
      setSelectedTerritory(null);
    }
  }, [selectedTerritoryId, territories]);

  const initializeScreen = async () => {
    await checkTrackingStatus();
    await loadTerritories();
    await loadSavedSelections();
    await loadActiveSessionData();
    setCheckingStatus(false);
  };

  const loadTerritories = async () => {
    try {
      const workerTerritories = await getWorkerTerritories(worker.id);
      setTerritories(workerTerritories);
    } catch (error) {
      console.error('Error loading territories:', error);
    }
  };

  const checkTrackingStatus = async () => {
    const active = await isTrackingActive(worker.id);
    setTracking(active);
  };

  const loadSavedSelections = async () => {
    try {
      const savedTerritoryId = await AsyncStorage.getItem('selectedTerritoryId');
      const savedFlyerOption = await AsyncStorage.getItem('selectedFlyerOption');
      
      if (savedTerritoryId) {
        console.log('Loaded saved territory:', savedTerritoryId);
        setSelectedTerritoryId(savedTerritoryId);
      }
      
      if (savedFlyerOption) {
        console.log('Loaded saved flyer option:', savedFlyerOption);
        setSelectedFlyerOption(parseInt(savedFlyerOption));
      }
    } catch (error) {
      console.error('Error loading saved selections:', error);
    }
  };

  const loadActiveSessionData = async () => {
    try {
      let sessionId = await AsyncStorage.getItem('activeSessionId');
      
      console.log('Checking active session data...');
      
      if (!sessionId) {
        console.log('No sessionId in AsyncStorage, checking Firestore...');
        
        const workerDoc = await firestore()
          .collection('workers')
          .doc(worker.id)
          .get();
        
        if (workerDoc.exists && workerDoc.data().activeSessionId) {
          sessionId = workerDoc.data().activeSessionId;
          console.log('Found activeSessionId from worker:', sessionId);
          await AsyncStorage.setItem('activeSessionId', sessionId);
        }
      } else {
        console.log('SessionId exists in AsyncStorage:', sessionId);
      }
      
      if (sessionId) {
        const sessionDoc = await firestore()
          .collection('sessions')
          .doc(sessionId)
          .get();
        
        if (sessionDoc.exists && sessionDoc.data().status === 'active') {
          const sessionData = sessionDoc.data();
          console.log('Session data loaded:', sessionData);
          
          if (sessionData.territoryId) {
            console.log('Setting territoryId:', sessionData.territoryId);
            setSelectedTerritoryId(sessionData.territoryId);
            await AsyncStorage.setItem('selectedTerritoryId', sessionData.territoryId);
          }
          
          if (sessionData.flyerCount) {
            console.log('Setting flyerCount:', sessionData.flyerCount);
            setSelectedFlyerOption(sessionData.flyerCount);
            await AsyncStorage.setItem('selectedFlyerOption', sessionData.flyerCount.toString());
          }
        } else {
          console.log('Session not found or not active');
        }
      }
    } catch (error) {
      console.error('Error loading active session data:', error);
    }
  };

  const handleTerritoryChange = async (territoryId) => {
    setSelectedTerritoryId(territoryId);
    try {
      await AsyncStorage.setItem('selectedTerritoryId', territoryId);
    } catch (error) {
      console.error('Error saving territory selection:', error);
    }
  };

  const handleFlyerOptionChange = async (option) => {
    setSelectedFlyerOption(option);
    try {
      await AsyncStorage.setItem('selectedFlyerOption', option.toString());
    } catch (error) {
      console.error('Error saving flyer selection:', error);
    }
  };

  const handleStartTracking = async () => {
    if (!selectedTerritoryId) {
      Alert.alert(
        'Odaberi teren',
        'Molimo odaberi teren prije početka rada.',
      );
      return;
    }

    if (!selectedFlyerOption) {
      Alert.alert(
        'Odaberi broj letaka',
        'Molimo odaberi broj letaka (1, 2, 3 ili 4).',
      );
      return;
    }

    setLoading(true);

    const result = await startTracking(
      worker.id,
      worker.name,
      selectedTerritoryId,
      selectedFlyerOption,
    );

    if (result.success) {
      const sessionId = result.sessionId;
      
      const confirmed = await waitForSessionSync(sessionId);
      
      setTracking(true);
      setLoading(false);
      
      if (confirmed) {
        Alert.alert('✅ Uspjeh', 'Tracking je pokrenut!');
      } else {
        Alert.alert('✅ Uspjeh', 'Tracking je pokrenut! (Sync u tijeku...)');
      }
    } else {
      setLoading(false);
      Alert.alert('❌ Greška', 'Nije moguće pokrenuti tracking.');
    }
  };

  const waitForSessionSync = async (sessionId) => {
    const maxAttempts = 10;
    const delayMs = 300;
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const sessionDoc = await firestore()
          .collection('sessions')
          .doc(sessionId)
          .get();
        
        if (sessionDoc.exists && sessionDoc.data().status === 'active') {
          console.log(`✅ Session synced to Firebase after ${(i + 1) * delayMs}ms`);
          return true;
        }
      } catch (error) {
        console.error('Error checking session:', error);
      }
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    console.warn('⚠️ Session sync timeout - continuing anyway');
    return false;
  };

  const handleStopTracking = () => {
    Alert.alert(
      'Zaustavi tracking?',
      'Jeste li sigurni da želite zaustaviti tracking?',
      [
        {text: 'Odustani', style: 'cancel'},
        {
          text: 'Zaustavi',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            const result = await stopTracking();
            setLoading(false);

            if (result.success) {
              setTracking(false);
              
              try {
                await AsyncStorage.removeItem('selectedTerritoryId');
                await AsyncStorage.removeItem('selectedFlyerOption');
              } catch (error) {
                console.error('Error clearing selections:', error);
              }
              
              setSelectedTerritoryId('');
              setSelectedFlyerOption(null);
              Alert.alert('✅ Uspjeh', 'Tracking je zaustavljen!');
            } else {
              Alert.alert('❌ Greška', 'Nije moguće zaustaviti tracking.');
            }
          },
        },
      ],
    );
  };

  const handleLogout = async () => {
    if (tracking) {
      Alert.alert('Upozorenje', 'Tracking je aktivan. Molimo zaustavite tracking prije odjave.');
      return;
    }

    Alert.alert(
      'Odjava',
      'Jeste li sigurni da se želite odjaviti?',
      [
        { text: 'Odustani', style: 'cancel' },
        {
          text: 'Odjavi se',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            
            const { logout } = require('../services/firebaseService');
            const result = await logout(worker.id);
            
            setLoading(false);
            
            if (result.success) {
              navigation.replace('Login');
            } else {
              Alert.alert('Greška', 'Nije moguće izvršiti odjavu.');
            }
          },
        },
      ],
    );
  };

  if (checkingStatus) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F9FAFB" />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Pozdrav,</Text>
            <Text style={styles.name}>{worker.name}</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>ID: {worker.id.split('-')[1]}</Text>
          </View>
        </View>

        <View
          style={[
            styles.statusCard,
            tracking && styles.statusCardActive,
          ]}>
          <View style={styles.statusIcon}>
            <Text style={styles.statusEmoji}>{tracking ? '📍' : '✓'}</Text>
          </View>
          <Text style={styles.statusTitle}>
            {tracking ? 'Tracking aktivan' : 'Sustav spreman'}
          </Text>
          <Text style={styles.statusSubtitle}>
            {tracking
              ? 'Vaše kretanje se prati'
              : 'Odaberite teren i broj letaka'}
          </Text>
        </View>

        <View style={styles.territoryCard}>
          <Text style={styles.territoryCardTitle}>Odaberi Teren</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={selectedTerritoryId}
              onValueChange={handleTerritoryChange}
              style={styles.picker}
              enabled={!tracking}
              dropdownIconColor="#10B981">
              <Picker.Item label="-- Odaberi teren --" value="" />
              {territories.map(territory => (
                <Picker.Item
                  key={territory.id}
                  label={territory.name}
                  value={territory.id}
                />
              ))}
            </Picker>
          </View>

          {selectedTerritory && ( 
          <> 
          <View style={styles.flyerOptionsContainer}>
          <Text style={styles.flyerOptionsLabel}>Odaberi broj letaka:</Text>
          <View style={styles.flyerButtonsRow}>
            {[1, 2, 3, 4].map(option => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.flyerButton,
                  selectedFlyerOption === option && styles.flyerButtonActive,
                  tracking && styles.flyerButtonDisabled
                ]}
                onPress={() => !tracking && handleFlyerOptionChange(option)}
                disabled={tracking}
                activeOpacity={0.7}>
                <Text style={[
                  styles.flyerButtonText,
                  selectedFlyerOption === option && styles.flyerButtonTextActive
                ]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        
          <View style={styles.flyerButtonsRow}>
            {[5, 6, 7, 8].map(option => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.flyerButton,
                  selectedFlyerOption === option && styles.flyerButtonActive,
                  tracking && styles.flyerButtonDisabled
                ]}
                onPress={() => !tracking && handleFlyerOptionChange(option)}
                disabled={tracking}
                activeOpacity={0.7}>
                <Text style={[
                  styles.flyerButtonText,
                  selectedFlyerOption === option && styles.flyerButtonTextActive
                ]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

              <TouchableOpacity
                style={styles.mapButton}
                onPress={() => navigation.navigate('Map', {worker, territory: selectedTerritory})}
                activeOpacity={0.8}>
                <Text style={styles.mapButtonText}>🗺️ Prikaži teren na mapi</Text>
              </TouchableOpacity>
            </>
          )}

          {tracking && (
            <Text style={styles.lockNote}>
              ℹ️ Odabir terena i letaka je zaključan dok je tracking aktivan
            </Text>
          )}
        </View>

        <View style={styles.infoSection}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Status</Text>
            <Text style={[styles.infoValue, tracking && styles.infoValueActive]}>
              {tracking ? 'Aktivan' : 'Neaktivan'}
            </Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Tereni</Text>
            <Text style={styles.infoValue}>
              {territories.length || 0}
            </Text>
          </View>
        </View>

        <View style={styles.actionsSection}>
          {!tracking ? (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleStartTracking}
              disabled={loading}
              activeOpacity={0.8}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>▶ Započni tracking</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.stopButton}
              onPress={handleStopTracking}
              disabled={loading}
              activeOpacity={0.8}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.stopButtonText}>■ Zaustavi tracking</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleLogout}
            activeOpacity={0.8}>
            <Text style={styles.secondaryButtonText}>Odjava</Text>
          </TouchableOpacity>
        </View>

        {tracking && (
          <View style={styles.trackingNote}>
            <Text style={styles.trackingNoteTitle}>📍 Tracking aktivan</Text>
            <Text style={styles.trackingNoteText}>
              Aplikacija bilježi vašu lokaciju svake 2 sekunde. Možete
              koristiti mobitel normalno - tracking radi u pozadini.
            </Text>
          </View>
        )}

        {!tracking && (
          <View style={styles.comingSoonCard}>
            <Text style={styles.comingSoonTitle}>🚀 Testiranje GPS</Text>
            <Text style={styles.comingSoonText}>
              Odaberite teren i broj letaka, pritisnite "Započni tracking" i prošetajte 2-3 minute.
            </Text>
          </View>
        )}
      </ScrollView>
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
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  greeting: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 4,
  },
  name: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1F2937',
  },
  badge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  statusCard: {
    backgroundColor: '#10B981',
    marginHorizontal: 24,
    marginBottom: 24,
    padding: 24,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#10B981',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  statusCardActive: {
    backgroundColor: '#059669',
  },
  statusIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusEmoji: {
    fontSize: 28,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  statusSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
  territoryCard: {
    backgroundColor: '#fff',
    marginHorizontal: 24,
    marginBottom: 24,
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  territoryCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 12,
  },
  pickerContainer: {
    borderWidth: 2,
    borderColor: '#10B981',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  picker: {
    height: 50,
    color: '#1F2937',
  },
  flyerOptionsContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  flyerOptionsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 12,
  },
  flyerButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  flyerButton: {
    flex: 1,
    height: 56,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  flyerButtonActive: {
    backgroundColor: '#D1FAE5',
    borderColor: '#10B981',
  },
  flyerButtonDisabled: {
    opacity: 0.5,
  },
  flyerButtonText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#6B7280',
  },
  flyerButtonTextActive: {
    color: '#059669',
  },
  mapButton: {
    height: 48,
    backgroundColor: '#fff',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 2,
    borderColor: '#10B981',
  },
  mapButtonText: {
    color: '#10B981',
    fontSize: 15,
    fontWeight: '600',
  },
  lockNote: {
    marginTop: 12,
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  infoSection: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 24,
    gap: 12,
  },
  infoCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  infoLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
  },
  infoValueActive: {
    color: '#10B981',
  },
  actionsSection: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  primaryButton: {
    height: 56,
    backgroundColor: '#10B981',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#10B981',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  stopButton: {
    height: 56,
    backgroundColor: '#EF4444',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#EF4444',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 56,
    backgroundColor: '#fff',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  secondaryButtonText: {
    color: '#6B7280',
    fontSize: 16,
    fontWeight: '600',
  },
  trackingNote: {
    marginHorizontal: 24,
    marginBottom: 24,
    padding: 20,
    backgroundColor: '#D1FAE5',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#10B981',
  },
  trackingNoteTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#059669',
    marginBottom: 8,
  },
  trackingNoteText: {
    fontSize: 14,
    color: '#047857',
    lineHeight: 20,
  },
  comingSoonCard: {
    marginHorizontal: 24,
    marginBottom: 40,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  comingSoonTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  comingSoonText: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 22,
  },
});

export default HomeScreen;