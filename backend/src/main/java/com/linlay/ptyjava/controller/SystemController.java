package com.linlay.ptyjava.controller;

import com.linlay.ptyjava.model.SystemVersionResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.info.BuildProperties;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/webapi", "/appapi"})
public class SystemController {

    private final BuildProperties buildProperties;

    @Value("${spring.application.name:pty-web-backend}")
    private String applicationName;

    @Value("${app.version:0.0.1-SNAPSHOT}")
    private String applicationVersion;

    @Value("${APP_GIT_SHA:unknown}")
    private String gitSha;

    @Value("${APP_BUILD_TIME:unknown}")
    private String buildTime;

    public SystemController(ObjectProvider<BuildProperties> buildPropertiesProvider) {
        this.buildProperties = buildPropertiesProvider.getIfAvailable();
    }

    @GetMapping("/version")
    public ResponseEntity<SystemVersionResponse> version() {
        String resolvedVersion = resolveVersion();
        String resolvedBuildTime = resolveBuildTime();
        return ResponseEntity.ok(new SystemVersionResponse(applicationName, resolvedVersion, gitSha, resolvedBuildTime));
    }

    private String resolveVersion() {
        if (buildProperties != null && StringUtils.hasText(buildProperties.getVersion())) {
            return buildProperties.getVersion();
        }
        Package appPackage = SystemController.class.getPackage();
        if (appPackage != null && StringUtils.hasText(appPackage.getImplementationVersion())) {
            return appPackage.getImplementationVersion();
        }
        return applicationVersion;
    }

    private String resolveBuildTime() {
        if (buildProperties != null && buildProperties.getTime() != null) {
            return buildProperties.getTime().toString();
        }
        return buildTime;
    }
}
