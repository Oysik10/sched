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
} from 'react-native';
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
  });

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCreateAccount = () => {
    // TODO: Firebase create user logic
    console.log('Creating account with:', form);
    router.replace('/auth'); // or navigate elsewhere
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
