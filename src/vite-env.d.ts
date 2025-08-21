/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_BACKEND_VERIFY_URL?: string; // optional backend endpoint to verify ID tokens
  readonly VITE_BACKEND_API_BASE?: string; // base URL for unified backend (e.g., https://api.example.com)
  readonly VITE_UPSTASH_REDIS_REST_URL?: string;
  readonly VITE_UPSTASH_REDIS_REST_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
