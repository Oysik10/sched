import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../src/firebaseConfig';
import { router } from 'expo-router';

const SignUpScreen = () => {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    state: '',
    country: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validatePassword = (password: string) => {
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    const isLongEnough = password.length >= 8;
    return hasUppercase && hasNumber && isLongEnough;
  };

  const handleCreateAccount = async () => {
    const { email, password, confirmPassword } = form;

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }

    if (!validatePassword(password)) {
      Alert.alert(
        'Weak Password',
        'Password must be at least 8 characters long and include at least one uppercase letter and one number.'
      );
      return;
    }

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      Alert.alert('Account created!', 'You can now log in.');
      router.replace('/auth');
    } catch (error: any) {
      Alert.alert('Signup Error', error.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.title}>Create Your PlanPal Account</Text>

        {[
          { label: 'First Name', key: 'firstName' },
          { label: 'Last Name', key: 'lastName' },
          { label: 'State', key: 'state' },
          { label: 'Country', key: 'country' },
          { label: 'Phone Number', key: 'phone', keyboardType: 'phone-pad' },
          { label: 'Email', key: 'email', keyboardType: 'email-address' },
          { label: 'Password', key: 'password', secure: true },
          { label: 'Confirm Password', key: 'confirmPassword', secure: true },
        ].map(({ label, key, keyboardType, secure }) => (
          <View key={key} style={{ marginBottom: 16 }}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
              value={form[key as keyof typeof form]}
              onChangeText={(value) => updateField(key, value)}
              style={styles.input}
              placeholder={label}
              placeholderTextColor="#888"
              keyboardType={keyboardType as any}
              secureTextEntry={secure}
            />
          </View>
        ))}

        <TouchableOpacity style={styles.button} onPress={handleCreateAccount}>
          <Text style={styles.buttonText}>Create Account</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default SignUpScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollContainer: {
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
  },
  label: {
    color: '#ccc',
    marginBottom: 6,
    fontSize: 14,
  },
  input: {
    height: 48,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#444',
    backgroundColor: '#111',
  },
  button: {
    backgroundColor: '#1e3a8a',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
