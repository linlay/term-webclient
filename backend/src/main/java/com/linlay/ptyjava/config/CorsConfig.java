package com.linlay.ptyjava.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final TerminalProperties terminalProperties;

    public CorsConfig(TerminalProperties terminalProperties) {
        this.terminalProperties = terminalProperties;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOriginPatterns(terminalProperties.getAllowedOrigins().toArray(String[]::new))
            .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
            .allowedHeaders("*");
    }
}
