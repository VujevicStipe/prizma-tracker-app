import React, {useState} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {loginWithPin} from '../services/firebaseService';

function LoginScreen({navigation}) {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (pin.length !== 4) {
      Alert.alert('Greška', 'PIN mora imati 4 znamenke');
      return;
    }

    setLoading(true);
    const result = await loginWithPin(pin);
    setLoading(false);

    if (result.success) {
      navigation.replace('Home', {worker: result.worker});
    } else {
      Alert.alert('Greška', result.error);
      setPin('');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F9FAFB" />
      
      <View style={styles.content}>
        {/* Logo Area */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>P</Text>
          </View>
          <Text style={styles.brandName}>Prizma Tracker</Text>
          <View style={styles.divider} />
        </View>

        {/* Input Area */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Unesite vaš PIN</Text>
          <TextInput
            style={styles.input}
            placeholder="••••"
            placeholderTextColor="#9CA3AF"
            keyboardType="number-pad"
            maxLength={4}
            value={pin}
            onChangeText={setPin}
            secureTextEntry
            autoFocus
            editable={!loading}
          />
        </View>

        {/* Button */}
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Prijavi se</Text>
          )}
        </TouchableOpacity>

        {/* Hint */}
        <Text style={styles.hint}>
          Za testiranje koristite PIN: 1234
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  
  // Logo Styles
  logoContainer: {
    alignItems: 'center',
    marginBottom: 60,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#10B981',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  logoText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#fff',
  },
  brandName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  divider: {
    width: 60,
    height: 4,
    backgroundColor: '#10B981',
    borderRadius: 2,
  },
  
  // Input Styles
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4B5563',
    marginBottom: 12,
  },
  input: {
    height: 64,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 24,
    fontSize: 32,
    fontWeight: '600',
    textAlign: 'center',
    color: '#1F2937',
    letterSpacing: 8,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  
  // Button Styles
  button: {
    height: 56,
    backgroundColor: '#10B981',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#10B981',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonDisabled: {
    backgroundColor: '#9CA3AF',
    shadowOpacity: 0,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  
  // Hint
  hint: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 24,
  },
});

export default LoginScreen;