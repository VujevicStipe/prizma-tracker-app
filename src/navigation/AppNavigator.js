import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firestore from '@react-native-firebase/firestore';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import MapScreen from '../screens/MapScreen';

const Stack = createNativeStackNavigator();

function AppNavigator() {
  const [isLoading, setIsLoading] = useState(true);
  const [initialRoute, setInitialRoute] = useState('Login');
  const [initialParams, setInitialParams] = useState(null);

  useEffect(() => {
    checkLoginSession();
  }, []);

  const checkLoginSession = async () => {
    try {
      const loginSessionId = await AsyncStorage.getItem('activeLoginSession');
      const workerId = await AsyncStorage.getItem('loggedInWorkerId');

      console.log('Checking login session:', { loginSessionId, workerId });

      if (loginSessionId && workerId) {
        const loginSessionDoc = await firestore()
          .collection('loginSessions')
          .doc(loginSessionId)
          .get();

        if (loginSessionDoc.exists && loginSessionDoc.data().active === true) {
          const workerDoc = await firestore()
            .collection('workers')
            .doc(workerId)
            .get();

          if (workerDoc.exists) {
            console.log('Auto-login successful');
            setInitialRoute('Home');
            setInitialParams({
              worker: {
                id: workerDoc.id,
                ...workerDoc.data()
              }
            });
            setIsLoading(false);
            return;
          }
        }

        // Session not active - cleanup
        await AsyncStorage.removeItem('activeLoginSession');
        await AsyncStorage.removeItem('loggedInWorkerId');
      }

      console.log('No valid login session');
      setInitialRoute('Login');
      setIsLoading(false);
    } catch (error) {
      console.error('Session check error:', error);
      setInitialRoute('Login');
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerShown: false,
        }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen 
          name="Home" 
          component={HomeScreen}
          initialParams={initialParams}
        />
        <Stack.Screen 
          name="Map" 
          component={MapScreen}
          options={{
            headerShown: true,
            headerTitle: 'Mapa praćenja',
            headerStyle: {backgroundColor: '#10B981'},
            headerTintColor: '#fff',
            headerTitleStyle: {fontWeight: '700'},
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
});

export default AppNavigator;