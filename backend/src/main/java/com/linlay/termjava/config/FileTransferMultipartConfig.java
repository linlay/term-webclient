package com.linlay.termjava.config;

import jakarta.servlet.MultipartConfigElement;
import org.springframework.boot.web.servlet.MultipartConfigFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.unit.DataSize;

@Configuration
public class FileTransferMultipartConfig {

    @Bean
    public MultipartConfigElement multipartConfigElement(TerminalProperties terminalProperties) {
        TerminalProperties.FilesProperties files = terminalProperties.getFiles();
        long maxFileBytes = files == null ? 200L * 1024L * 1024L : Math.max(1L, files.getMaxUploadFileBytes());
        long maxRequestBytes = files == null
            ? 500L * 1024L * 1024L
            : Math.max(maxFileBytes, files.getMaxUploadRequestBytes());

        MultipartConfigFactory factory = new MultipartConfigFactory();
        factory.setMaxFileSize(DataSize.ofBytes(maxFileBytes));
        factory.setMaxRequestSize(DataSize.ofBytes(maxRequestBytes));
        return factory.createMultipartConfig();
    }
}
