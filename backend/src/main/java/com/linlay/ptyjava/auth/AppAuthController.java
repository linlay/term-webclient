package com.linlay.ptyjava.auth;

import com.linlay.ptyjava.model.auth.AuthStatusResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/appapi/auth")
public class AppAuthController {

    private final AppTokenService appTokenService;

    public AppAuthController(AppTokenService appTokenService) {
        this.appTokenService = appTokenService;
    }

    @GetMapping("/me")
    public ResponseEntity<AuthStatusResponse> me(HttpServletRequest request) {
        return ResponseEntity.ok(appTokenService.currentStatus(request));
    }

    @ExceptionHandler(AuthUnauthorizedException.class)
    public ResponseEntity<Map<String, String>> handleUnauthorized(AuthUnauthorizedException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, String>> handleIllegalState(IllegalStateException ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", ex.getMessage()));
    }
}
