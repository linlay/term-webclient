package com.linlay.ptyjava.controller;

import com.linlay.ptyjava.model.WorkdirBrowseResponse;
import com.linlay.ptyjava.service.InvalidWorkdirBrowseRequestException;
import com.linlay.ptyjava.service.WorkdirBrowseService;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/workdirTree")
public class WorkdirController {

    private final WorkdirBrowseService workdirBrowseService;

    public WorkdirController(WorkdirBrowseService workdirBrowseService) {
        this.workdirBrowseService = workdirBrowseService;
    }

    @GetMapping
    public WorkdirBrowseResponse browseWorkdirs(@RequestParam(required = false) String path) {
        return workdirBrowseService.browse(path);
    }

    @ExceptionHandler(InvalidWorkdirBrowseRequestException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(InvalidWorkdirBrowseRequestException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, String>> handleRuntime(RuntimeException ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "workdir browse operation failed"));
    }
}
