package com.linlay.termjava;

import com.linlay.termjava.config.AppAuthProperties;
import com.linlay.termjava.config.AuthProperties;
import com.linlay.termjava.config.TerminalProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties({TerminalProperties.class, AuthProperties.class, AppAuthProperties.class})
public class TerminalApplication {

    public static void main(String[] args) {
        SpringApplication.run(TerminalApplication.class, args);
    }
}
