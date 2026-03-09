package auth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

const webSessionCookieName = "term_web_auth_session"

type Service struct {
	cfg           *config.Config
	webSessions   map[string]webSession
	webSessionsMu sync.Mutex
	rateLimiter   *loginRateLimiter
	httpClient    *http.Client

	jwksMu      sync.Mutex
	jwksCache   map[string]*rsa.PublicKey
	jwksExpires time.Time
}

type webSession struct {
	Username  string
	ExpiresAt time.Time
}

type loginRateLimiter struct {
	mu       sync.Mutex
	cfg      config.AuthConfig
	failures map[string][]int64
}

type jwtHeader struct {
	Alg string `json:"alg"`
	KID string `json:"kid"`
	Typ string `json:"typ"`
}

type jwtClaims struct {
	Sub      string      `json:"sub"`
	Username string      `json:"username"`
	Iss      string      `json:"iss"`
	Aud      interface{} `json:"aud"`
	Exp      int64       `json:"exp"`
	Nbf      int64       `json:"nbf"`
}

type jwksDocument struct {
	Keys []jwkKey `json:"keys"`
}

type jwkKey struct {
	KTY string `json:"kty"`
	KID string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func New(cfg *config.Config) *Service {
	return &Service{
		cfg:         cfg,
		webSessions: map[string]webSession{},
		rateLimiter: &loginRateLimiter{
			cfg:      cfg.Auth,
			failures: map[string][]int64{},
		},
		httpClient: &http.Client{Timeout: 5 * time.Second},
		jwksCache:  map[string]*rsa.PublicKey{},
	}
}

func (s *Service) CurrentWebStatus(r *http.Request) model.AuthStatusResponse {
	if !s.cfg.Auth.Enabled {
		return model.AuthStatusResponse{Enabled: false, Authenticated: true, Username: "anonymous"}
	}
	username, _ := s.webSessionUsername(r)
	return model.AuthStatusResponse{
		Enabled:       true,
		Authenticated: username != "",
		Username:      username,
	}
}

func (s *Service) Login(w http.ResponseWriter, r *http.Request, request model.LoginRequest) (model.AuthStatusResponse, error) {
	if !s.cfg.Auth.Enabled {
		return model.AuthStatusResponse{Enabled: false, Authenticated: true, Username: "anonymous"}, nil
	}
	if strings.TrimSpace(s.cfg.Auth.Username) == "" {
		return model.AuthStatusResponse{}, util.NewStatusError(http.StatusInternalServerError, "auth.username is required when auth is enabled", nil)
	}
	if strings.TrimSpace(normalizeBcryptHash(s.cfg.Auth.PasswordHashBcrypt)) == "" {
		return model.AuthStatusResponse{}, util.NewStatusError(http.StatusInternalServerError, "auth.password-hash-bcrypt must be configured when auth is enabled", nil)
	}

	username := strings.TrimSpace(request.Username)
	password := request.Password
	rateLimitKey := s.rateLimiter.resolveRateLimitKey(r, username)
	if err := s.rateLimiter.ensureAllowed(rateLimitKey); err != nil {
		return model.AuthStatusResponse{}, err
	}

	usernameMatches := username == strings.TrimSpace(s.cfg.Auth.Username)
	passwordMatches := bcrypt.CompareHashAndPassword([]byte(normalizeBcryptHash(s.cfg.Auth.PasswordHashBcrypt)), []byte(password)) == nil
	if !usernameMatches || !passwordMatches {
		s.rateLimiter.recordFailure(rateLimitKey)
		return model.AuthStatusResponse{}, util.NewStatusError(http.StatusUnauthorized, "invalid username or password", nil)
	}
	s.rateLimiter.recordSuccess(rateLimitKey)

	sessionID := util.NewID()
	expiresAt := time.Now().UTC().Add(time.Duration(s.cfg.Auth.SessionTTLSeconds) * time.Second)
	s.webSessionsMu.Lock()
	s.webSessions[sessionID] = webSession{
		Username:  username,
		ExpiresAt: expiresAt,
	}
	s.webSessionsMu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     webSessionCookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   s.cfg.Auth.SessionTTLSeconds,
	})
	return model.AuthStatusResponse{
		Enabled:       true,
		Authenticated: true,
		Username:      username,
	}, nil
}

func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(webSessionCookieName); err == nil {
		s.webSessionsMu.Lock()
		delete(s.webSessions, cookie.Value)
		s.webSessionsMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{
		Name:     webSessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0).UTC(),
	})
}

func (s *Service) RequireWeb(r *http.Request) (string, error) {
	if !s.cfg.Auth.Enabled {
		return "anonymous", nil
	}
	username, err := s.webSessionUsername(r)
	if err != nil || username == "" {
		return "", util.NewStatusError(http.StatusUnauthorized, "unauthorized", err)
	}
	return username, nil
}

func (s *Service) CurrentAppStatus(r *http.Request) (model.AuthStatusResponse, error) {
	if !s.cfg.AppAuth.Enabled {
		return model.AuthStatusResponse{Enabled: false, Authenticated: true, Username: "anonymous"}, nil
	}
	username, err := s.RequireApp(r)
	if err != nil {
		return model.AuthStatusResponse{}, err
	}
	return model.AuthStatusResponse{
		Enabled:       true,
		Authenticated: true,
		Username:      username,
	}, nil
}

func (s *Service) RequireApp(r *http.Request) (string, error) {
	if !s.cfg.AppAuth.Enabled {
		return "anonymous", nil
	}
	token := extractBearerToken(r.Header.Get("Authorization"))
	if token == "" {
		return "", util.NewStatusError(http.StatusUnauthorized, "unauthorized", nil)
	}
	return s.AuthenticateToken(r.Context(), token)
}

func (s *Service) AuthenticateWSToken(r *http.Request) (string, error) {
	if !s.cfg.Auth.Enabled && !s.cfg.AppAuth.Enabled {
		return "anonymous", nil
	}
	if username, err := s.webSessionUsername(r); err == nil && username != "" {
		return username, nil
	}
	token := strings.TrimSpace(r.URL.Query().Get("accessToken"))
	if token == "" {
		return "", util.NewStatusError(http.StatusUnauthorized, "unauthorized", nil)
	}
	return s.AuthenticateToken(r.Context(), token)
}

func (s *Service) AuthenticateToken(ctx context.Context, token string) (string, error) {
	if !s.cfg.AppAuth.Enabled {
		return "anonymous", nil
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", util.NewStatusError(http.StatusUnauthorized, "invalid jwt token", nil)
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", util.NewStatusError(http.StatusUnauthorized, "invalid jwt token", err)
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", util.NewStatusError(http.StatusUnauthorized, "invalid jwt claims", err)
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", util.NewStatusError(http.StatusUnauthorized, "invalid jwt signature", err)
	}

	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return "", util.NewStatusError(http.StatusUnauthorized, "invalid jwt token", err)
	}
	var claims jwtClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return "", util.NewStatusError(http.StatusUnauthorized, "invalid jwt claims", err)
	}

	publicKey, err := s.resolveVerificationKey(ctx, header.KID)
	if err != nil {
		return "", err
	}
	signingInput := []byte(parts[0] + "." + parts[1])
	if err := verifyRSASignature(header.Alg, publicKey, signingInput, signature); err != nil {
		return "", util.NewStatusError(http.StatusUnauthorized, "jwt signature verification failed", err)
	}
	if err := s.validateClaims(claims); err != nil {
		return "", err
	}
	if strings.TrimSpace(claims.Sub) != "" {
		return strings.TrimSpace(claims.Sub), nil
	}
	if strings.TrimSpace(claims.Username) != "" {
		return strings.TrimSpace(claims.Username), nil
	}
	return "app-user", nil
}

func (s *Service) webSessionUsername(r *http.Request) (string, error) {
	cookie, err := r.Cookie(webSessionCookieName)
	if err != nil {
		return "", err
	}
	s.webSessionsMu.Lock()
	defer s.webSessionsMu.Unlock()
	session, ok := s.webSessions[cookie.Value]
	if !ok {
		return "", errors.New("web session missing")
	}
	if time.Now().UTC().After(session.ExpiresAt) {
		delete(s.webSessions, cookie.Value)
		return "", errors.New("web session expired")
	}
	return session.Username, nil
}

func normalizeBcryptHash(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) >= 2 {
		first := trimmed[0]
		last := trimmed[len(trimmed)-1]
		if (first == '\'' && last == '\'') || (first == '"' && last == '"') {
			return strings.TrimSpace(trimmed[1 : len(trimmed)-1])
		}
	}
	return trimmed
}

func extractBearerToken(header string) string {
	value := strings.TrimSpace(header)
	if !strings.HasPrefix(strings.ToLower(value), "bearer ") {
		return ""
	}
	return strings.TrimSpace(value[len("Bearer "):])
}

func (l *loginRateLimiter) resolveRateLimitKey(r *http.Request, username string) string {
	user := strings.TrimSpace(username)
	if user == "" {
		user = "anonymous"
	}
	forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if forwarded != "" {
		if idx := strings.Index(forwarded, ","); idx >= 0 {
			forwarded = forwarded[:idx]
		}
		return strings.TrimSpace(forwarded) + "|" + user
	}
	return r.RemoteAddr + "|" + user
}

func (l *loginRateLimiter) ensureAllowed(key string) error {
	if !l.cfg.LoginRateLimitEnabled {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now().UTC().UnixMilli()
	cutoff := now - int64(max(10, l.cfg.LoginRateLimitWindowSeconds))*1000
	queue := l.trim(key, cutoff)
	if len(queue) >= max(1, l.cfg.LoginRateLimitMaxAttempts) {
		return util.NewStatusError(http.StatusTooManyRequests, "too many login attempts, please retry later", nil)
	}
	return nil
}

func (l *loginRateLimiter) recordFailure(key string) {
	if !l.cfg.LoginRateLimitEnabled {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now().UTC().UnixMilli()
	cutoff := now - int64(max(10, l.cfg.LoginRateLimitWindowSeconds))*1000
	queue := l.trim(key, cutoff)
	l.failures[key] = append(queue, now)
}

func (l *loginRateLimiter) recordSuccess(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, key)
}

func (l *loginRateLimiter) trim(key string, cutoff int64) []int64 {
	values := l.failures[key]
	if len(values) == 0 {
		return []int64{}
	}
	trimmed := values[:0]
	for _, value := range values {
		if value >= cutoff {
			trimmed = append(trimmed, value)
		}
	}
	l.failures[key] = trimmed
	return trimmed
}

func (s *Service) resolveVerificationKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	if localFile := strings.TrimSpace(s.cfg.AppAuth.LocalPublicKeyFile); localFile != "" {
		return parseLocalPublicKeyFile(localFile)
	}
	if strings.TrimSpace(s.cfg.AppAuth.JWKSURI) == "" {
		return nil, util.NewStatusError(http.StatusUnauthorized, "missing jwt verification key", nil)
	}
	return s.fetchJWKSKey(ctx, kid)
}

func parseLocalPublicKeyFile(path string) (*rsa.PublicKey, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return nil, util.NewStatusError(http.StatusUnauthorized, "invalid local public key file (read failed)", err)
	}
	block, _ := pem.Decode(payload)
	if block == nil {
		return nil, util.NewStatusError(http.StatusUnauthorized, "invalid local public key file (pem decode failed)", nil)
	}
	key, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, util.NewStatusError(http.StatusUnauthorized, "invalid local public key file (rsa parse failed)", err)
	}
	rsaKey, ok := key.(*rsa.PublicKey)
	if !ok {
		return nil, util.NewStatusError(http.StatusUnauthorized, "invalid local public key file (rsa parse failed)", nil)
	}
	return rsaKey, nil
}

func (s *Service) fetchJWKSKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	s.jwksMu.Lock()
	if time.Now().UTC().Before(s.jwksExpires) {
		if key := s.pickJWKSKeyLocked(kid); key != nil {
			s.jwksMu.Unlock()
			return key, nil
		}
	}
	s.jwksMu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.AppAuth.JWKSURI, nil)
	if err != nil {
		return nil, util.NewStatusError(http.StatusUnauthorized, "failed to build jwks request", err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, util.NewStatusError(http.StatusUnauthorized, "failed to fetch jwks", err)
	}
	defer resp.Body.Close()
	var doc jwksDocument
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return nil, util.NewStatusError(http.StatusUnauthorized, "failed to decode jwks", err)
	}

	cache := map[string]*rsa.PublicKey{}
	for _, item := range doc.Keys {
		if item.KTY != "RSA" {
			continue
		}
		key, err := parseJWK(item)
		if err != nil {
			continue
		}
		cache[item.KID] = key
	}
	if len(cache) == 0 {
		return nil, util.NewStatusError(http.StatusUnauthorized, "no usable rsa jwks keys", nil)
	}

	s.jwksMu.Lock()
	s.jwksCache = cache
	s.jwksExpires = time.Now().UTC().Add(time.Duration(s.cfg.AppAuth.JWKSCacheSeconds) * time.Second)
	key := s.pickJWKSKeyLocked(kid)
	s.jwksMu.Unlock()
	if key == nil {
		return nil, util.NewStatusError(http.StatusUnauthorized, "jwks key is missing", nil)
	}
	return key, nil
}

func (s *Service) pickJWKSKeyLocked(kid string) *rsa.PublicKey {
	if kid != "" {
		return s.jwksCache[kid]
	}
	for _, key := range s.jwksCache {
		return key
	}
	return nil
}

func parseJWK(item jwkKey) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(item.N)
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(item.E)
	if err != nil {
		return nil, err
	}
	n := new(big.Int).SetBytes(nb)
	e := 0
	for _, value := range eb {
		e = e<<8 + int(value)
	}
	return &rsa.PublicKey{N: n, E: e}, nil
}

func verifyRSASignature(alg string, key *rsa.PublicKey, signingInput, signature []byte) error {
	var hash crypto.Hash
	switch alg {
	case "RS256":
		hash = crypto.SHA256
	case "RS384":
		hash = crypto.SHA384
	case "RS512":
		hash = crypto.SHA512
	default:
		return errors.New("only RSA algorithms are supported")
	}
	hasher := hash.New()
	_, _ = hasher.Write(signingInput)
	digest := hasher.Sum(nil)
	return rsa.VerifyPKCS1v15(key, hash, digest, signature)
}

func (s *Service) validateClaims(claims jwtClaims) error {
	now := time.Now().UTC().Unix()
	skew := int64(max(0, s.cfg.AppAuth.ClockSkewSeconds))
	if claims.Exp == 0 {
		return util.NewStatusError(http.StatusUnauthorized, "token is missing exp", nil)
	}
	if now > claims.Exp+skew {
		return util.NewStatusError(http.StatusUnauthorized, "token has expired", nil)
	}
	if claims.Nbf != 0 && now < claims.Nbf-skew {
		return util.NewStatusError(http.StatusUnauthorized, "token is not active yet", nil)
	}
	if expected := strings.TrimSpace(s.cfg.AppAuth.Issuer); expected != "" && expected != strings.TrimSpace(claims.Iss) {
		return util.NewStatusError(http.StatusUnauthorized, "token issuer is invalid", nil)
	}
	if expected := strings.TrimSpace(s.cfg.AppAuth.Audience); expected != "" && !audienceMatches(expected, claims.Aud) {
		return util.NewStatusError(http.StatusUnauthorized, "token audience is invalid", nil)
	}
	return nil
}

func audienceMatches(expected string, aud interface{}) bool {
	expectedValues := splitCSV(expected)
	switch value := aud.(type) {
	case string:
		for _, item := range expectedValues {
			if item == strings.TrimSpace(value) {
				return true
			}
		}
	case []interface{}:
		for _, raw := range value {
			text, ok := raw.(string)
			if !ok {
				continue
			}
			for _, item := range expectedValues {
				if item == strings.TrimSpace(text) {
					return true
				}
			}
		}
	}
	return false
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, item := range parts {
		if strings.TrimSpace(item) == "" {
			continue
		}
		result = append(result, strings.TrimSpace(item))
	}
	return result
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
