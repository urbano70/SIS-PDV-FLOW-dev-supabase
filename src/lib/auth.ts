import { supabase } from './supabase';

export async function signInOwner(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpOwner(email: string, password: string, establishmentName: string) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { establishment_name: establishmentName } }
  });
  if (error) throw error;
  return data;
}

export async function signOutOwner() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export function onAuthStateChange(callback: (user: any) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/login?mode=reset`,
  });
  if (error) throw error;
}

export async function updateUserPassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function updateUserMetadata(data: Record<string, any>) {
  const { error } = await supabase.auth.updateUser({ data });
  if (error) throw error;
}
