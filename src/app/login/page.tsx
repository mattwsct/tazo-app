"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loginToAdmin } from '@/lib/client-auth';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  // Check if user is already authenticated
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/get-settings', {
          credentials: 'include',
        });
        if (response.ok) {
          // Already authenticated, redirect to admin
          router.push('/');
        }
      } catch {
        // Not authenticated, stay on login page
      }
    };

    checkAuth();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const result = await loginToAdmin(password);
      
      if (result.success) {
        router.push('/');
      } else {
        setError(result.error || 'Invalid password');
      }
    } catch (error) {
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-root">
      <div className="login-container">
        <div className="login-header">
          <div className="login-icon">🎮</div>
          <h1 className="login-title">Overlay Admin</h1>
          <p className="login-subtitle">Enter password to access admin panel</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <div className="input-group">
            <label htmlFor="password" className="input-label">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="password-input"
              placeholder="Enter admin password"
              required
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="error-message">
              <span className="error-icon">❌</span>
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="login-button"
            disabled={isLoading || !password.trim()}
          >
            {isLoading ? (
              <>
                <div className="loading-spinner"></div>
                <span>Logging in...</span>
              </>
            ) : (
              <>
                <span className="login-icon">🔐</span>
                <span>Login</span>
              </>
            )}
          </button>
        </form>
      </div>

      <style jsx>{`
        .login-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 1rem;
        }

        .login-container {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 1rem;
          padding: 2.5rem;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
          width: 100%;
          max-width: 400px;
          text-align: center;
        }

        .login-header {
          margin-bottom: 2rem;
        }

        .login-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
          display: block;
        }

        .login-title {
          font-size: 1.75rem;
          font-weight: 700;
          color: #1a1a1a;
          margin-bottom: 0.5rem;
        }

        .login-subtitle {
          color: #666;
          font-size: 0.875rem;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .input-group {
          text-align: left;
        }

        .input-label {
          display: block;
          font-weight: 600;
          color: #1a1a1a;
          margin-bottom: 0.5rem;
          font-size: 0.875rem;
        }

        .password-input {
          width: 100%;
          padding: 0.75rem 1rem;
          border: 2px solid #e1e5e9;
          border-radius: 0.5rem;
          font-size: 1rem;
          transition: all 0.2s ease;
          background: white;
        }

        .password-input:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .password-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .error-message {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #dc2626;
          font-size: 0.875rem;
          padding: 0.75rem;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 0.5rem;
        }

        .error-icon {
          font-size: 1rem;
        }

        .login-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 0.5rem;
          font-weight: 600;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s ease;
          width: 100%;
        }

        .login-button:hover:not(:disabled) {
          background: #5a67d8;
          transform: translateY(-1px);
        }

        .login-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .loading-spinner {
          width: 1rem;
          height: 1rem;
          border: 2px solid transparent;
          border-top: 2px solid white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 480px) {
          .login-container {
            padding: 2rem;
          }

          .login-title {
            font-size: 1.5rem;
          }
        }
      `}</style>
    </div>
  );
} 