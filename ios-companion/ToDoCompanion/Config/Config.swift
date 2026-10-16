import Foundation

struct AppConfig {
    // Supabase Configuration
    // Fill in your project URL and anon public key from your Supabase dashboard:
    // https://app.supabase.com/project/_/settings/api
    static var supabaseURL: String {
        return UserDefaults.standard.string(forKey: "supabase_url") ?? "https://YOUR_PROJECT_ID.supabase.co"
    }
    
    static var supabaseAnonKey: String {
        return UserDefaults.standard.string(forKey: "supabase_anon_key") ?? "YOUR_SUPABASE_ANON_KEY"
    }
    
    // Gemini API Configuration
    static var geminiAPIKey: String {
        return UserDefaults.standard.string(forKey: "gemini_api_key") ?? "AQ.Ab8RN6IcCg0ZHzgemvtrQ-8oyseoCX5QSMOxKBT_aCyMXrHd6w"
    }
    
    static var isSupabaseConfigured: Bool {
        return !supabaseURL.contains("YOUR_PROJECT_ID") && !supabaseAnonKey.contains("YOUR_SUPABASE_ANON_KEY")
    }
}
