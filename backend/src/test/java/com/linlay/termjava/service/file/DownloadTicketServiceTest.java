package com.linlay.termjava.service.file;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.linlay.termjava.model.file.FileDownloadTicketMode;
import java.util.List;
import org.junit.jupiter.api.Test;

class DownloadTicketServiceTest {

    @Test
    void consumeSucceedsOnlyOnce() {
        DownloadTicketService service = new DownloadTicketService();
        DownloadTicketService.IssuedDownloadTicket issued = service.issue(
            FileDownloadTicketMode.SINGLE,
            "s1",
            "web:admin",
            "/tmp/a.txt",
            null,
            null,
            60
        );

        DownloadTicketService.DownloadTicketPayload first = service.consume(
            issued.ticket(),
            "s1",
            FileDownloadTicketMode.SINGLE,
            "web:admin"
        );
        assertNotNull(first);
        assertEquals("/tmp/a.txt", first.path());

        assertThrows(FileTransferForbiddenException.class, () -> service.consume(
            issued.ticket(),
            "s1",
            FileDownloadTicketMode.SINGLE,
            "web:admin"
        ));
    }

    @Test
    void consumeRejectsActorMismatch() {
        DownloadTicketService service = new DownloadTicketService();
        DownloadTicketService.IssuedDownloadTicket issued = service.issue(
            FileDownloadTicketMode.ARCHIVE,
            "s1",
            "web:alice",
            null,
            List.of("/tmp/a.txt"),
            "bundle.zip",
            60
        );

        assertThrows(FileTransferForbiddenException.class, () -> service.consume(
            issued.ticket(),
            "s1",
            FileDownloadTicketMode.ARCHIVE,
            "web:bob"
        ));
    }

    @Test
    void consumeAllowsMissingActorForTicketDownloadFlow() {
        DownloadTicketService service = new DownloadTicketService();
        DownloadTicketService.IssuedDownloadTicket issued = service.issue(
            FileDownloadTicketMode.SINGLE,
            "s1",
            "app:alice",
            "/tmp/a.txt",
            null,
            null,
            60
        );

        DownloadTicketService.DownloadTicketPayload payload = service.consume(
            issued.ticket(),
            "s1",
            FileDownloadTicketMode.SINGLE,
            null
        );
        assertEquals("/tmp/a.txt", payload.path());
    }
}
