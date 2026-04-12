import { type ReactNode } from 'react';
export interface AuthState {
    isAuthenticated: boolean;
    isLoading: boolean;
    error: string | null;
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
}
export declare function useAuth(): AuthState;
export declare function AuthProvider({ children }: {
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=useAuth.d.ts.map