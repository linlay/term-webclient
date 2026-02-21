package com.linlay.ptyjava.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.linlay.ptyjava.config.TerminalProperties;
import com.linlay.ptyjava.model.WorkdirBrowseResponse;
import com.linlay.ptyjava.model.WorkdirEntry;
import com.linlay.ptyjava.service.InvalidWorkdirBrowseRequestException;
import com.linlay.ptyjava.service.WorkdirBrowseService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(WorkdirController.class)
class WorkdirControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private WorkdirBrowseService workdirBrowseService;

    @MockBean
    private TerminalProperties terminalProperties;

    @Test
    void browseReturnsEntries() throws Exception {
        when(workdirBrowseService.browse(null))
            .thenReturn(new WorkdirBrowseResponse(
                "/home/user",
                "/home/user",
                List.of(new WorkdirEntry("repo", "/home/user/repo", true))
            ));

        mockMvc.perform(get("/webapi/workdirTree"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.rootPath").value("/home/user"))
            .andExpect(jsonPath("$.currentPath").value("/home/user"))
            .andExpect(jsonPath("$.entries[0].name").value("repo"))
            .andExpect(jsonPath("$.entries[0].path").value("/home/user/repo"))
            .andExpect(jsonPath("$.entries[0].hasChildren").value(true));
    }

    @Test
    void browseReturns400OnInvalidPath() throws Exception {
        when(workdirBrowseService.browse("/outside"))
            .thenThrow(new InvalidWorkdirBrowseRequestException("path must be inside browse root"));

        mockMvc.perform(get("/webapi/workdirTree").queryParam("path", "/outside"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("path must be inside browse root"));
    }
}
