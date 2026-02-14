package com.linlay.ptyjava.config;

import com.linlay.ptyjava.auth.AuthInterceptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final TerminalProperties terminalProperties;
    private final AuthInterceptor authInterceptor;

    public CorsConfig(TerminalProperties terminalProperties,
                      ObjectProvider<AuthInterceptor> authInterceptorProvider) {
        this.terminalProperties = terminalProperties;
        this.authInterceptor = authInterceptorProvider.getIfAvailable();
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOriginPatterns(terminalProperties.getAllowedOrigins().toArray(String[]::new))
            .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
            .allowedHeaders("*");
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        if (authInterceptor == null) {
            return;
        }
        registry.addInterceptor(authInterceptor)
            .addPathPatterns("/api/**")
            .excludePathPatterns("/api/auth/**");
    }
}
