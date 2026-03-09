package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

func TestLoginWithBcryptCreatesWebSession(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("secret-123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("generate bcrypt hash: %v", err)
	}

	svc := New(&config.Config{
		Auth: config.AuthConfig{
			Enabled:                     true,
			Username:                    "tester",
			PasswordHashBcrypt:          string(passwordHash),
			SessionTTLSeconds:           300,
			LoginRateLimitEnabled:       true,
			LoginRateLimitWindowSeconds: 60,
			LoginRateLimitMaxAttempts:   10,
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/webapi/auth/login", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	recorder := httptest.NewRecorder()

	status, err := svc.Login(recorder, req, model.LoginRequest{
		Username: "tester",
		Password: "secret-123",
	})
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}
	if !status.Enabled || !status.Authenticated || status.Username != "tester" {
		t.Fatalf("unexpected login status: %+v", status)
	}

	authenticatedRequest := httptest.NewRequest(http.MethodGet, "/webapi/sessions", nil)
	for _, cookie := range recorder.Result().Cookies() {
		authenticatedRequest.AddCookie(cookie)
	}

	username, err := svc.RequireWeb(authenticatedRequest)
	if err != nil {
		t.Fatalf("require web auth: %v", err)
	}
	if username != "tester" {
		t.Fatalf("expected authenticated username tester, got %q", username)
	}
}

func TestLoginRejectsWrongPassword(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("secret-123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("generate bcrypt hash: %v", err)
	}

	svc := New(&config.Config{
		Auth: config.AuthConfig{
			Enabled:                     true,
			Username:                    "tester",
			PasswordHashBcrypt:          string(passwordHash),
			SessionTTLSeconds:           300,
			LoginRateLimitEnabled:       true,
			LoginRateLimitWindowSeconds: 60,
			LoginRateLimitMaxAttempts:   10,
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/webapi/auth/login", nil)
	req.RemoteAddr = "127.0.0.1:12345"

	_, err = svc.Login(httptest.NewRecorder(), req, model.LoginRequest{
		Username: "tester",
		Password: "wrong-password",
	})
	if util.ErrorStatus(err) != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong password, got %d (%v)", util.ErrorStatus(err), err)
	}
}

func TestLoginSupportsQuotedBcryptHash(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("secret-123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("generate bcrypt hash: %v", err)
	}

	testCases := []struct {
		name string
		hash string
	}{
		{
			name: "single quoted",
			hash: "'" + string(passwordHash) + "'",
		},
		{
			name: "double quoted",
			hash: `"` + string(passwordHash) + `"`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			svc := New(&config.Config{
				Auth: config.AuthConfig{
					Enabled:                     true,
					Username:                    "tester",
					PasswordHashBcrypt:          tc.hash,
					SessionTTLSeconds:           300,
					LoginRateLimitEnabled:       true,
					LoginRateLimitWindowSeconds: 60,
					LoginRateLimitMaxAttempts:   10,
				},
			})

			req := httptest.NewRequest(http.MethodPost, "/webapi/auth/login", nil)
			req.RemoteAddr = "127.0.0.1:12345"

			status, err := svc.Login(httptest.NewRecorder(), req, model.LoginRequest{
				Username: "tester",
				Password: "secret-123",
			})
			if err != nil {
				t.Fatalf("login failed: %v", err)
			}
			if !status.Authenticated || status.Username != "tester" {
				t.Fatalf("unexpected login status: %+v", status)
			}
		})
	}
}

func TestLoginFailsWhenBcryptHashMissing(t *testing.T) {
	svc := New(&config.Config{
		Auth: config.AuthConfig{
			Enabled:                     true,
			Username:                    "tester",
			PasswordHashBcrypt:          "",
			SessionTTLSeconds:           300,
			LoginRateLimitEnabled:       true,
			LoginRateLimitWindowSeconds: 60,
			LoginRateLimitMaxAttempts:   10,
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/webapi/auth/login", nil)
	req.RemoteAddr = "127.0.0.1:12345"

	_, err := svc.Login(httptest.NewRecorder(), req, model.LoginRequest{
		Username: "tester",
		Password: "secret-123",
	})
	if util.ErrorStatus(err) != http.StatusInternalServerError {
		t.Fatalf("expected 500 when bcrypt hash is missing, got %d (%v)", util.ErrorStatus(err), err)
	}
}

func TestRequireAppWithLocalPublicKey(t *testing.T) {
	privateKey := testRSAKey(t)
	publicKeyFile := writePublicKeyFile(t, publicKeyPEM(t, &privateKey.PublicKey))
	token := signRS256Token(t, privateKey, "kid-1", jwtClaims{
		Sub: "mobile-user",
		Iss: "issuer.example",
		Aud: "appterm",
		Exp: time.Now().UTC().Add(5 * time.Minute).Unix(),
		Nbf: time.Now().UTC().Add(-1 * time.Minute).Unix(),
	})

	svc := New(&config.Config{
		AppAuth: config.AppAuthConfig{
			Enabled:            true,
			LocalPublicKeyFile: publicKeyFile,
			Issuer:             "issuer.example",
			Audience:           "appterm",
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/appapi/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	username, err := svc.RequireApp(req)
	if err != nil {
		t.Fatalf("require app auth: %v", err)
	}
	if username != "mobile-user" {
		t.Fatalf("expected mobile-user, got %q", username)
	}
}

func TestRequireAppRejectsInvalidSignature(t *testing.T) {
	verificationKey := testRSAKey(t)
	signingKey := testRSAKey(t)
	publicKeyFile := writePublicKeyFile(t, publicKeyPEM(t, &verificationKey.PublicKey))
	token := signRS256Token(t, signingKey, "kid-1", jwtClaims{
		Sub: "mobile-user",
		Iss: "issuer.example",
		Aud: "appterm",
		Exp: time.Now().UTC().Add(5 * time.Minute).Unix(),
		Nbf: time.Now().UTC().Add(-1 * time.Minute).Unix(),
	})

	svc := New(&config.Config{
		AppAuth: config.AppAuthConfig{
			Enabled:            true,
			LocalPublicKeyFile: publicKeyFile,
			Issuer:             "issuer.example",
			Audience:           "appterm",
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/appapi/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	_, err := svc.RequireApp(req)
	if util.ErrorStatus(err) != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid signature, got %d (%v)", util.ErrorStatus(err), err)
	}
}

func TestRequireAppFailsWhenVerificationKeyMissing(t *testing.T) {
	privateKey := testRSAKey(t)
	token := signRS256Token(t, privateKey, "kid-1", jwtClaims{
		Sub: "mobile-user",
		Iss: "issuer.example",
		Aud: "appterm",
		Exp: time.Now().UTC().Add(5 * time.Minute).Unix(),
		Nbf: time.Now().UTC().Add(-1 * time.Minute).Unix(),
	})

	svc := New(&config.Config{
		AppAuth: config.AppAuthConfig{
			Enabled:  true,
			Issuer:   "issuer.example",
			Audience: "appterm",
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/appapi/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	_, err := svc.RequireApp(req)
	if util.ErrorStatus(err) != http.StatusUnauthorized {
		t.Fatalf("expected 401 when verification key is missing, got %d (%v)", util.ErrorStatus(err), err)
	}
}

func TestAuthenticateWSTokenSupportsWebSessionAndAppToken(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("secret-123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("generate bcrypt hash: %v", err)
	}
	privateKey := testRSAKey(t)
	publicKeyFile := writePublicKeyFile(t, publicKeyPEM(t, &privateKey.PublicKey))
	appToken := signRS256Token(t, privateKey, "kid-1", jwtClaims{
		Sub: "app-user",
		Iss: "issuer.example",
		Aud: "appterm",
		Exp: time.Now().UTC().Add(5 * time.Minute).Unix(),
		Nbf: time.Now().UTC().Add(-1 * time.Minute).Unix(),
	})

	svc := New(&config.Config{
		Auth: config.AuthConfig{
			Enabled:                     true,
			Username:                    "tester",
			PasswordHashBcrypt:          string(passwordHash),
			SessionTTLSeconds:           300,
			LoginRateLimitEnabled:       true,
			LoginRateLimitWindowSeconds: 60,
			LoginRateLimitMaxAttempts:   10,
		},
		AppAuth: config.AppAuthConfig{
			Enabled:            true,
			LocalPublicKeyFile: publicKeyFile,
			Issuer:             "issuer.example",
			Audience:           "appterm",
		},
	})

	loginRequest := httptest.NewRequest(http.MethodPost, "/webapi/auth/login", nil)
	loginRequest.RemoteAddr = "127.0.0.1:12345"
	loginRecorder := httptest.NewRecorder()
	if _, err := svc.Login(loginRecorder, loginRequest, model.LoginRequest{
		Username: "tester",
		Password: "secret-123",
	}); err != nil {
		t.Fatalf("login failed: %v", err)
	}

	wsCookieRequest := httptest.NewRequest(http.MethodGet, "/ws/session-1", nil)
	for _, cookie := range loginRecorder.Result().Cookies() {
		wsCookieRequest.AddCookie(cookie)
	}
	username, err := svc.AuthenticateWSToken(wsCookieRequest)
	if err != nil {
		t.Fatalf("authenticate websocket cookie request: %v", err)
	}
	if username != "tester" {
		t.Fatalf("expected websocket cookie auth to resolve tester, got %q", username)
	}

	wsTokenRequest := httptest.NewRequest(http.MethodGet, "/ws/session-1?accessToken="+appToken, nil)
	username, err = svc.AuthenticateWSToken(wsTokenRequest)
	if err != nil {
		t.Fatalf("authenticate websocket token request: %v", err)
	}
	if username != "app-user" {
		t.Fatalf("expected websocket token auth to resolve app-user, got %q", username)
	}
}

func testRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	return privateKey
}

func publicKeyPEM(t *testing.T, publicKey *rsa.PublicKey) string {
	t.Helper()
	encoded, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}
	block := &pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: encoded,
	}
	return string(pem.EncodeToMemory(block))
}

func writePublicKeyFile(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "local-public-key.pem")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write public key file: %v", err)
	}
	return path
}

func signRS256Token(t *testing.T, privateKey *rsa.PrivateKey, kid string, claims jwtClaims) string {
	t.Helper()
	headerPayload, err := json.Marshal(map[string]string{
		"alg": "RS256",
		"typ": "JWT",
		"kid": kid,
	})
	if err != nil {
		t.Fatalf("marshal jwt header: %v", err)
	}
	claimsPayload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal jwt claims: %v", err)
	}
	signingInput := base64.RawURLEncoding.EncodeToString(headerPayload) + "." + base64.RawURLEncoding.EncodeToString(claimsPayload)
	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature)
}
