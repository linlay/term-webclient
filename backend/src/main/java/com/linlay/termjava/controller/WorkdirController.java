package com.linlay.termjava.controller;

import com.linlay.termjava.model.WorkdirBrowseResponse;
import com.linlay.termjava.service.InvalidWorkdirBrowseRequestException;
import com.linlay.termjava.service.WorkdirBrowseService;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/webapi/workdirTree", "/appapi/workdirTree"})
public class WorkdirController {

    private final WorkdirBrowseService workdirBrowseService;

    public WorkdirController(WorkdirBrowseService workdirBrowseService) {
        this.workdirBrowseService = workdirBrowseService;
    }

    @GetMapping
    public ResponseEntity<WorkdirBrowseResponse> browseWorkdirs(@RequestParam(required = false) String path) {
        return ResponseEntity.ok()
            .header("Deprecation", "true")
            .header("Sunset", DateTimeFormatter.RFC_1123_DATE_TIME.format(ZonedDateTime.now().plusMonths(3)))
            .body(workdirBrowseService.browse(path));
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
