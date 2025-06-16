import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, Alert,
} from 'react-native';
import RNPickerSelect from 'react-native-picker-select';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../src/firebaseConfig';
import { router } from 'expo-router';

export default function SignUpScreen() {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', confirmPassword: '',
  });
  const [passValid, setPassValid] = useState(false);
  const [passMatch, setPassMatch] = useState(false);

  useEffect(() => {
    const { password, confirmPassword } = form;
    const hasUpper = /[A-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    const isLong = password.length >= 8;
    setPassValid(hasUpper && hasNumber && isLong);
    setPassMatch(password !== '' && password === confirmPassword);
  }, [form.password, form.confirmPassword]);

  const updateField = (key: string, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleCreateAccount = async () => {
    for (const [k, v] of Object.entries(form)) {
      if (!v) {
        Alert.alert('Missing Field', `Please fill out ${k.replace(/([A-Z])/g, ' $1')}.`);
        return;
      }
    }
    if (!passValid) {
      Alert.alert(
        'Weak Password',
        'Password must be 8+ chars, include at least one uppercase and one number.'
      );
      return;
    }
    if (!passMatch) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    try {
      await createUserWithEmailAndPassword(auth, form.email, form.password);
      Alert.alert('Account created!', 'You can now log in.');
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Signup Error', e.message);
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
        { label: 'Email', key: 'email' },
        ].map(({ label, key }) => (
        <View key={key} style={styles.fieldGroup}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
            value={form[key as keyof typeof form]}  // <- This line is important for TypeScript
            onChangeText={(v) => updateField(key, v)}
            placeholder={label}
            placeholderTextColor="#888"
            style={styles.input}
            keyboardType={key === 'email' ? 'email-address' : 'default'}
            autoCapitalize={key === 'email' ? 'none' : 'words'}
            />
        </View>
        ))}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            value={form.password}
            onChangeText={(v) => updateField('password', v)}
            placeholder="Password"
            placeholderTextColor="#888"
            secureTextEntry
            style={styles.input}
          />
          <Text style={[styles.passInfo, passValid ? styles.valid : styles.invalid]}>
            • 8+ characters,One uppercase,One number
          </Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Confirm Password</Text>
          <View style={styles.confirmRow}>
            <TextInput
              value={form.confirmPassword}
              onChangeText={(v) => updateField('confirmPassword', v)}
              placeholder="Confirm Password"
              placeholderTextColor="#888"
              secureTextEntry
              style={[styles.input, { flex: 1 }]}
            />
            <Text style={[styles.matchIcon, passMatch ? styles.valid : styles.invalid]}>
              {passMatch ? '✓' : '✗'}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleCreateAccount}>
          <Text style={styles.buttonText}>Create Account</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  scrollContainer: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 28, color: '#fff', fontWeight: 'bold', marginBottom: 24, textAlign: 'center' },
  fieldGroup: { marginBottom: 16 },
  label: { color: '#ccc', marginBottom: 6, fontSize: 14 },
  input: {
    height: 48, borderRadius: 10, paddingHorizontal: 12,
    fontSize: 16, color: '#fff', borderWidth: 1, borderColor: '#444', backgroundColor: '#111',
  },
  passInfo: { marginTop: 4, fontSize: 12 },
  valid: { color: '#4CAF50' },
  invalid: { color: '#F44336' },
  confirmRow: { flexDirection: 'row', alignItems: 'center' },
  matchIcon: { fontSize: 18, marginLeft: 8 },
  button: { backgroundColor: '#1e3a8a', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

const pickerStyles = {
  inputIOS: {
    height: 48, fontSize: 16, color: '#fff', paddingHorizontal: 12,
    borderRadius: 10, backgroundColor: '#111', borderWidth: 1, borderColor: '#444',
    marginBottom: 4,
  },
  inputAndroid: {
    height: 48, fontSize: 16, color: '#fff', paddingHorizontal: 12,
    borderRadius: 10, backgroundColor: '#111', borderWidth: 1, borderColor: '#444',
    marginBottom: 4,
  },
  placeholder: { color: '#888' },
};
