import { computed, inject, Injectable, signal } from '@angular/core';
import { AuthSession, Session, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  readonly session = signal<Session | null>(null);
  readonly currentUser = computed<User | null>(() => this.session()?.user ?? null);
  readonly isAuthenticated = computed<boolean>(() => !!this.session());
  readonly isLoading = signal<boolean>(true);

  constructor() {
    this.initializeAuth();
  }

  private async initializeAuth(): Promise<void> {
    try {
      const { data } = await this.supabase.client.auth.getSession();
      this.session.set(data.session);
    } catch (err) {
      console.error('Failed to initialize Supabase session:', err);
      this.session.set(null);
    } finally {
      this.isLoading.set(false);
    }

    this.supabase.client.auth.onAuthStateChange((_event, newSession: AuthSession | null) => {
      this.session.set(newSession);
      this.isLoading.set(false);
    });
  }

  async signInWithPassword(credentials: { email: string; password: string }) {
    const response = await this.supabase.client.auth.signInWithPassword(credentials);
    if (response.error) {
      throw response.error;
    }
    if (response.data.session) {
      this.session.set(response.data.session);
    }
    return response.data;
  }

  async signOut(): Promise<void> {
    await this.supabase.client.auth.signOut();
    this.session.set(null);
  }
}
