package com.linlay.termjava.config;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RequestContextConfig {

    @Bean
    public FilterRegistrationBean<RequestContextFilter> requestContextFilterRegistration() {
        FilterRegistrationBean<RequestContextFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new RequestContextFilter());
        registration.addUrlPatterns("/*");
        registration.setOrder(0);
        return registration;
    }
}
