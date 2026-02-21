package com.linlay.ptyjava.controller;

import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.TerminalClientResponse;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/webapi/terminal", "/appapi/terminal"})
public class TerminalClientController {

    private final TerminalProperties terminalProperties;

    public TerminalClientController(TerminalProperties terminalProperties) {
        this.terminalProperties = terminalProperties;
    }

    @GetMapping("/clients")
    public ResponseEntity<List<TerminalClientResponse>> clients() {
        List<TerminalClientResponse> responses = new ArrayList<>();
        for (TerminalProperties.CliClientProperties client : terminalProperties.getCliClients()) {
            if (client == null || !StringUtils.hasText(client.getId())) {
                continue;
            }
            String id = client.getId().trim();
            String label = StringUtils.hasText(client.getLabel()) ? client.getLabel().trim() : id;
            String defaultWorkdir = StringUtils.hasText(client.getWorkdir())
                ? client.getWorkdir().trim()
                : terminalProperties.getDefaultWorkdir();
            responses.add(new TerminalClientResponse(id, label, defaultWorkdir));
        }
        return ResponseEntity.ok(responses);
    }
}
