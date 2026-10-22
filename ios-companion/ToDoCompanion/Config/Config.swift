import Foundation

struct AppConfig {
    // Supabase Configuration
    // Fill in your project URL and anon public key from your Supabase dashboard:
    // https://app.supabase.com/project/_/settings/api
    static var supabaseURL: String {
        if let val = UserDefaults.standard.string(forKey: "supabase_url"), !val.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return val
        }
        return "https://huwattmqwiqhcfhtqely.supabase.co"
    }
    
    static var supabaseAnonKey: String {
        if let val = UserDefaults.standard.string(forKey: "supabase_anon_key"), !val.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return val
        }
        return "sb_secret_21i-I_QCc5xA_dPeVQPKsg_iV7ZzjQm"
    }
    
    // Gemini API Configuration
    static var geminiAPIKey: String {
        if let val = UserDefaults.standard.string(forKey: "gemini_api_key"), !val.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return val
        }
        return "AQ.Ab8RN6IcCg0ZHzgemvtrQ-8oyseoCX5QSMOxKBT_aCyMXrHd6w"
    }
    
    static var isSupabaseConfigured: Bool {
        return !supabaseURL.contains("YOUR_PROJECT_ID") && !supabaseAnonKey.contains("YOUR_SUPABASE_ANON_KEY")
    }
}
