package com.linlay.termjava.service.file;

import com.linlay.termjava.auth.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class RequestActorResolver {

    private final AuthService authService;

    public RequestActorResolver(ObjectProvider<AuthService> authServiceProvider) {
        this.authService = authServiceProvider.getIfAvailable();
    }

    public String resolve(HttpServletRequest request) {
        String actor = resolveAuthenticated(request);
        return StringUtils.hasText(actor) ? actor : "anonymous";
    }

    public String resolveAuthenticated(HttpServletRequest request) {
        if (request == null) {
            return null;
        }

        Object appPrincipal = request.getAttribute("appPrincipal");
        if (appPrincipal instanceof String username && StringUtils.hasText(username)) {
            return "app:" + username.trim();
        }

        if (authService != null) {
            String username = authService.authenticatedUsername(request);
            if (StringUtils.hasText(username)) {
                return "web:" + username.trim();
            }
        }
        return null;
    }
}
