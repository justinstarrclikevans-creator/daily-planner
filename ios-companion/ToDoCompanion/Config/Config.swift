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
    private static let defaultToken = "QVEuQWI4Uk42SVhCUU85RUc5RE1BV2NDa282M19nWFh5b2lNZmNxcE9Ka21jeWNPWVF6WkE="
    
    static var geminiAPIKey: String {
        if let val = UserDefaults.standard.string(forKey: "gemini_api_key"),
           !val.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           !val.contains("Ab8RN6IcCg0Z") {
            return val
        }
        if let data = Data(base64Encoded: defaultToken), let str = String(data: data, encoding: .utf8) {
            return str
        }
        return ""
    }
    
    static var isSupabaseConfigured: Bool {
        return !supabaseURL.contains("YOUR_PROJECT_ID") && !supabaseAnonKey.contains("YOUR_SUPABASE_ANON_KEY")
    }
}
