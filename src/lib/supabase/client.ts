import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

export type SupabasePublicConfig = {
	url: string;
	publishableKey: string;
};

let browserClient: SupabaseClient | null | undefined;

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
	const url = env.PUBLIC_SUPABASE_URL?.trim();
	const publishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

	return url && publishableKey ? { url, publishableKey } : null;
}

export function isSupabaseConfigured(): boolean {
	return getSupabasePublicConfig() !== null;
}

/**
 * Returns a browser-safe client, or null when local Supabase configuration has
 * not been provided. Never pass a secret/service-role key to this factory.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
	if (!browser) return null;
	if (browserClient !== undefined) return browserClient;

	const config = getSupabasePublicConfig();
	browserClient = config
		? createClient(config.url, config.publishableKey, {
				auth: {
					persistSession: true,
					autoRefreshToken: true,
					detectSessionInUrl: true
				}
			})
		: null;

	return browserClient;
}
