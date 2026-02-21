package com.linlay.ptyjava.config;

import com.linlay.ptyjava.auth.AppApiAuthInterceptor;
import com.linlay.ptyjava.auth.WebApiAuthInterceptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final TerminalProperties terminalProperties;
    private final WebApiAuthInterceptor webApiAuthInterceptor;
    private final AppApiAuthInterceptor appApiAuthInterceptor;

    public CorsConfig(TerminalProperties terminalProperties,
                      ObjectProvider<WebApiAuthInterceptor> webApiAuthInterceptorProvider,
                      ObjectProvider<AppApiAuthInterceptor> appApiAuthInterceptorProvider) {
        this.terminalProperties = terminalProperties;
        this.webApiAuthInterceptor = webApiAuthInterceptorProvider.getIfAvailable();
        this.appApiAuthInterceptor = appApiAuthInterceptorProvider.getIfAvailable();
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/webapi/**")
            .allowedOriginPatterns(terminalProperties.getAllowedOrigins().toArray(String[]::new))
            .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
            .allowedHeaders("*");
        registry.addMapping("/appapi/**")
            .allowedOriginPatterns(terminalProperties.getAllowedOrigins().toArray(String[]::new))
            .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
            .allowedHeaders("*");
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        if (webApiAuthInterceptor != null) {
            registry.addInterceptor(webApiAuthInterceptor)
                .addPathPatterns("/webapi/**")
                .excludePathPatterns("/webapi/auth/**", "/webapi/version");
        }
        if (appApiAuthInterceptor != null) {
            registry.addInterceptor(appApiAuthInterceptor)
                .addPathPatterns("/appapi/**")
                .excludePathPatterns("/appapi/version");
        }
    }
}
