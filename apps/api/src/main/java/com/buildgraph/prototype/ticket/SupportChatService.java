package com.buildgraph.prototype.ticket;

import com.buildgraph.prototype.common.DbValueMapper;
import com.buildgraph.prototype.common.MockData;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.MessageEvent;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.MessageRequest;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.RoomSummary;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.SavedMessage;
import com.buildgraph.prototype.ticket.SupportChatMessagingContract.UserSummary;
import com.buildgraph.prototype.user.CurrentUserService;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class SupportChatService {
    private static final int POLLING_INTERVAL_MS = 5000;
    // 닫힌 위젯 배지 폴링 주기: 전체 대화 조회가 아니라 요약만 하므로 훨씬 느슨하게.
    // 로그인 사용자 수에 비례해 깔리던 상시 부하(사용자당 5초마다 풀 detail)를 6배로 줄인다.
    private static final int CLOSED_POLLING_INTERVAL_MS = 30000;
    private static final int MAX_MESSAGE_LENGTH = 2000;
    private static final int ADMIN_LIST_LIMIT = 100;
    private static final int MESSAGE_PAGE_LIMIT = 100;
    private static final Set<String> TERMINAL_TICKET_STATUSES = Set.of("CLOSED", "CANCELLED");
    static final String SYSTEM_OPEN_MESSAGE = "상담방이 생성되었습니다. 문의 내용을 남기면 담당자가 확인합니다.";
    static final String SYSTEM_DELETE_MESSAGE = "관리자가 상담방을 삭제했습니다. 새 AS 접수가 가능합니다.";

    private final JdbcTemplate jdbcTemplate;

    public SupportChatService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Map<String, Object> current(CurrentUserService.CurrentUser user, String asTicketId) {
        String ticketId = stringOrNull(asTicketId);
        if (ticketId != null) {
            TicketRef ticket = requireUserTicket(ticketId, user);
            if (TERMINAL_TICKET_STATUSES.contains(ticket.status())) {
                return empty();
            }
            RoomRef room = ensureRoom(ticket, user);
            return detail(room.publicId(), user, false);
        }
        return findLatestUserRoom(user)
                .map(room -> detail(room.publicId(), user, false))
                .orElseGet(this::empty);
    }

    /**
     * 닫힌 위젯 배지용 요약. 무거운 messages()(최근 100건 + users JOIN)와
     * visitReservationMap(별도 SELECT)을 건너뛰고 룸 1행만 반환한다.
     * 배지에 필요한 unread/preview/canSend는 이미 룸 행에 있으므로 신규 쿼리는 없다.
     * markRead는 하지 않는다(닫힘 상태에서 읽음처리 금지 — 열 때만).
     */
    public Map<String, Object> currentSummary(CurrentUserService.CurrentUser user, String asTicketId) {
        String ticketId = stringOrNull(asTicketId);
        RoomRow room;
        if (ticketId != null) {
            TicketRef ticket = requireUserTicket(ticketId, user);
            if (TERMINAL_TICKET_STATUSES.contains(ticket.status())) {
                return emptySummary();
            }
            RoomRef ref = ensureRoom(ticket, user);
            room = roomForUser(ref.publicId(), user);
        } else {
            java.util.Optional<RoomRef> latest = findLatestUserRoom(user);
            if (latest.isEmpty()) {
                return emptySummary();
            }
            room = roomForUser(latest.get().publicId(), user);
        }
        return summaryResponse(room);
    }

    private Map<String, Object> summaryResponse(RoomRow room) {
        boolean canSend = "ACTIVE".equals(room.status())
                && !TERMINAL_TICKET_STATUSES.contains(room.ticketStatus());
        return MockData.map(
                "contact", MockData.map(
                        "id", room.publicId(),
                        "asTicketId", room.ticketPublicId(),
                        "status", room.status(),
                        "ticketStatus", room.ticketStatus(),
                        "title", room.title(),
                        "symptom", room.ticketSymptom(),
                        "lastMessagePreview", room.lastMessagePreview(),
                        "lastMessageAt", room.lastMessageAt(),
                        "userUnreadCount", room.userUnreadCount(),
                        "canSendMessage", canSend
                ),
                "messages", null,
                "summary", true,
                "supportNewPath", "/support/new",
                "pollingIntervalMs", CLOSED_POLLING_INTERVAL_MS
        );
    }

    private Map<String, Object> emptySummary() {
        return MockData.map(
                "contact", null,
                "messages", null,
                "summary", true,
                "supportNewPath", "/support/new",
                "pollingIntervalMs", CLOSED_POLLING_INTERVAL_MS
        );
    }

    public Map<String, Object> detail(String roomId, CurrentUserService.CurrentUser user) {
        return detail(roomId, user, true);
    }

    public Map<String, Object> detailSnapshot(String roomId, CurrentUserService.CurrentUser user) {
        return detail(roomId, user, false);
    }

    public Map<String, Object> adminList() {
        List<Map<String, Object>> items = jdbcTemplate.queryForList(roomSelect() + """
                        WHERE r.deleted_at IS NULL
                          AND t.deleted_at IS NULL
                          AND r.status = 'ACTIVE'
                          AND t.status NOT IN ('CLOSED', 'CANCELLED')
                        ORDER BY COALESCE(r.last_message_at, r.updated_at, r.created_at) DESC, r.id DESC
                        LIMIT ?
                        """, ADMIN_LIST_LIMIT)
                .stream()
                .map(row -> contactMap(roomRow(row)))
                .toList();
        return MockData.map("items", items, "pollingIntervalMs", POLLING_INTERVAL_MS);
    }

    public Optional<Map<String, Object>> adminQueueContactSnapshot(String roomId) {
        requireUuid(roomId);
        return jdbcTemplate.queryForList(roomSelect() + """
                        WHERE r.public_id = ?::uuid
                          AND r.deleted_at IS NULL
                          AND t.deleted_at IS NULL
                          AND r.status = 'ACTIVE'
                          AND t.status NOT IN ('CLOSED', 'CANCELLED')
                        """, roomId)
                .stream()
                .findFirst()
                .map(row -> contactMap(roomRow(row)));
    }

    public Optional<RoomSummary> roomSummary(String roomId) {
        requireUuid(roomId);
        return jdbcTemplate.queryForList(roomSelect() + """
                        WHERE r.public_id = ?::uuid
                          AND r.deleted_at IS NULL
                          AND t.deleted_at IS NULL
                        """, roomId)
                .stream()
                .findFirst()
                .map(this::roomRow)
                .map(this::roomSummary);
    }

    public Optional<RoomSummary> adminQueueRoomSummary(String roomId) {
        requireUuid(roomId);
        return jdbcTemplate.queryForList(roomSelect() + """
                        WHERE r.public_id = ?::uuid
                          AND r.deleted_at IS NULL
                          AND t.deleted_at IS NULL
                          AND r.status = 'ACTIVE'
                          AND t.status NOT IN ('CLOSED', 'CANCELLED')
                        """, roomId)
                .stream()
                .findFirst()
                .map(this::roomRow)
                .map(this::roomSummary);
    }

    public Map<String, Object> adminDetail(String roomId, CurrentUserService.CurrentUser admin) {
        return adminDetail(roomId, admin, true);
    }

    public Map<String, Object> adminDetailSnapshot(String roomId, CurrentUserService.CurrentUser admin) {
        return adminDetail(roomId, admin, false);
    }

    public Map<String, Object> adminDetail(String roomId, CurrentUserService.CurrentUser admin, boolean markRead) {
        requireUuid(roomId);
        RoomRow room = roomForAdmin(roomId);
        if (markRead) {
            jdbcTemplate.update("""
                    UPDATE support_chat_rooms
                    SET admin_unread_count = 0,
                        updated_at = COALESCE(updated_at, now())
                    WHERE id = ?
                    """, room.internalId());
            room = roomForAdmin(roomId);
        }
        return response(room, messages(room.internalId()));
    }

    @Transactional
    public SavedMessage saveMessage(MessageRequest request, CurrentUserService.CurrentUser sender) {
        if (request == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "메시지 요청이 필요합니다.");
        }
        String roomId = stringOrNull(request.roomId());
        if (roomId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "상담방 ID가 필요합니다.");
        }
        requireUuid(roomId);
        String clientMessageId = requireClientMessageId(request.clientMessageId());
        String content = requireMessage(Map.of("content", request.content() == null ? "" : request.content()));
        String senderRole = sender.role();
        RoomRow room;
        if ("USER".equals(senderRole)) {
            room = roomForUser(roomId, sender);
        } else if ("ADMIN".equals(senderRole)) {
            room = roomForAdmin(roomId);
        } else {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "상담 메시지를 보낼 권한이 없습니다.");
        }
        requireMessageAllowed(room);

        List<Map<String, Object>> insertedRows = jdbcTemplate.queryForList("""
                INSERT INTO support_chat_messages (
                  room_id,
                  role,
                  content,
                  sender_user_id,
                  client_message_id
                )
                VALUES (?, ?, ?, ?, ?::uuid)
                ON CONFLICT (sender_user_id, client_message_id)
                  WHERE client_message_id IS NOT NULL
                  DO NOTHING
                RETURNING public_id::text AS message_id,
                          client_message_id::text AS client_message_id,
                          content,
                          created_at
                """, room.internalId(), senderRole, content, sender.internalId(), clientMessageId);

        boolean inserted = !insertedRows.isEmpty();
        Map<String, Object> messageRow = inserted
                ? insertedRows.get(0)
                : existingMessage(sender.internalId(), clientMessageId);
        if (!inserted) {
            String existingRoomId = DbValueMapper.string(messageRow, "room_id");
            if (!roomId.equals(existingRoomId)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 다른 상담방에서 사용한 메시지 ID입니다.");
            }
        }

        if (inserted) {
            updateAfterMessage(room.internalId(), content, senderRole);
            if ("ADMIN".equals(senderRole)) {
                jdbcTemplate.update("""
                        UPDATE as_tickets
                        SET assigned_admin_id = COALESCE(assigned_admin_id, ?),
                            updated_at = now()
                        WHERE id = ?
                        """, sender.internalId(), room.ticketInternalId());
            }
        }

        RoomRow updatedRoom = "USER".equals(senderRole)
                ? roomForUser(roomId, sender)
                : roomForAdmin(roomId);
        MessageEvent event = new MessageEvent(
                MessageEvent.TYPE,
                DbValueMapper.string(messageRow, "message_id"),
                DbValueMapper.string(messageRow, "client_message_id"),
                roomId,
                sender.id(),
                senderRole,
                sender.name(),
                DbValueMapper.string(messageRow, "content"),
                DbValueMapper.timestamp(messageRow, "created_at"),
                roomSummary(updatedRoom)
        );
        return new SavedMessage(event, inserted);
    }

    @Transactional
    public Map<String, Object> deleteAdminSession(String roomId, CurrentUserService.CurrentUser admin) {
        RoomRow room = roomForAdminForUpdate(roomId);
        if ("ARCHIVED".equals(room.status())) {
            return response(room, messages(room.internalId()));
        }
        insertMessage(room.internalId(), "SYSTEM", SYSTEM_DELETE_MESSAGE, null);
        jdbcTemplate.update("""
                UPDATE support_chat_rooms
                SET status = ?,
                    last_message_preview = ?,
                    last_message_at = now(),
                    user_unread_count = user_unread_count + 1,
                    updated_at = now()
                WHERE id = ?
                """, "ARCHIVED", SYSTEM_DELETE_MESSAGE, room.internalId());
        String nextTicketStatus = room.ticketStatus();
        if (!TERMINAL_TICKET_STATUSES.contains(room.ticketStatus())) {
            nextTicketStatus = "CANCELLED";
            jdbcTemplate.update("""
                    UPDATE as_tickets
                    SET status = ?,
                        updated_at = now()
                    WHERE id = ?
                      AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED')
                    """, nextTicketStatus, room.ticketInternalId());
            jdbcTemplate.update("""
                    UPDATE remote_support_sessions
                    SET status = 'CANCELLED',
                        ended_at = COALESCE(ended_at, now()),
                        ended_reason = COALESCE(ended_reason, 'SUPPORT_CHAT_ARCHIVED')
                    WHERE as_ticket_id = ?
                      AND status IN ('REQUESTED', 'LINK_SENT', 'IN_PROGRESS')
                    """, room.ticketInternalId());
        }
        return response(archivedRoom(room, nextTicketStatus), messages(room.internalId()));
    }

    boolean userCanAccess(String roomId, CurrentUserService.CurrentUser user) {
        try {
            roomForUser(roomId, user);
            return true;
        } catch (ResponseStatusException error) {
            return false;
        }
    }

    boolean adminCanAccess(String roomId) {
        try {
            roomForAdmin(roomId);
            return true;
        } catch (ResponseStatusException error) {
            return false;
        }
    }

    private Map<String, Object> detail(String roomId, CurrentUserService.CurrentUser user, boolean markRead) {
        requireUuid(roomId);
        RoomRow room = roomForUser(roomId, user);
        if (markRead) {
            jdbcTemplate.update("""
                    UPDATE support_chat_rooms
                    SET user_unread_count = 0,
                        updated_at = COALESCE(updated_at, now())
                    WHERE id = ?
                    """, room.internalId());
            room = roomForUser(roomId, user);
        }
        return response(room, messages(room.internalId()));
    }

    private java.util.Optional<RoomRef> findLatestUserRoom(CurrentUserService.CurrentUser user) {
        return jdbcTemplate.queryForList("""
                        SELECT r.public_id::text AS id
                        FROM support_chat_rooms r
                        JOIN as_tickets t ON t.id = r.as_ticket_id
                        WHERE r.user_id = ?
                          AND r.status = 'ACTIVE'
                          AND r.deleted_at IS NULL
                          AND t.deleted_at IS NULL
                          AND t.status NOT IN ('CLOSED', 'CANCELLED')
                        ORDER BY COALESCE(r.last_message_at, r.updated_at, r.created_at) DESC, r.id DESC
                        LIMIT 1
                        """, user.internalId())
                .stream()
                .findFirst()
                .map(row -> new RoomRef(DbValueMapper.string(row, "id")));
    }

    private TicketRef requireUserTicket(String ticketId, CurrentUserService.CurrentUser user) {
        requireUuid(ticketId);
        return jdbcTemplate.queryForList("""
                        SELECT id AS internal_id,
                               public_id::text AS id,
                               symptom,
                               status
                        FROM as_tickets
                        WHERE public_id = ?::uuid
                          AND user_id = ?
                          AND deleted_at IS NULL
                        """, ticketId, user.internalId())
                .stream()
                .findFirst()
                .map(row -> new TicketRef(
                        longValue(row, "internal_id"),
                        DbValueMapper.string(row, "id"),
                        DbValueMapper.string(row, "symptom"),
                        DbValueMapper.string(row, "status")
                ))
                .orElseThrow(() -> notFound("AS 티켓을 찾을 수 없습니다."));
    }

    private RoomRef ensureRoom(TicketRef ticket, CurrentUserService.CurrentUser user) {
        return jdbcTemplate.queryForList("""
                        SELECT public_id::text AS id
                        FROM support_chat_rooms
                        WHERE user_id = ?
                          AND as_ticket_id = ?
                          AND status = 'ACTIVE'
                          AND deleted_at IS NULL
                        ORDER BY id DESC
                        LIMIT 1
                        """, user.internalId(), ticket.internalId())
                .stream()
                .findFirst()
                .map(row -> new RoomRef(DbValueMapper.string(row, "id")))
                .orElseGet(() -> createRoom(user.internalId(), ticket.internalId()));
    }

    private RoomRef createRoom(Long userInternalId, Long ticketInternalId) {
        return new RoomRef(SupportChatRoomCreator.ensureRoom(jdbcTemplate, userInternalId, ticketInternalId).publicId());
    }

    private RoomRow roomForUser(String roomId, CurrentUserService.CurrentUser user) {
        requireUuid(roomId);
        return jdbcTemplate.queryForList(roomSelect() + """
                        WHERE r.public_id = ?::uuid
                          AND r.user_id = ?
                          AND r.deleted_at IS NULL
                          AND t.deleted_at IS NULL
                        """, roomId, user.internalId())
                .stream()
                .findFirst()
                .map(row -> roomRow(row))
                .orElseThrow(() -> notFound("상담방을 찾을 수 없습니다."));
    }

    private RoomRow roomForAdmin(String roomId) {
        requireUuid(roomId);
        return jdbcTemplate.queryForList(roomSelect() + """
                        WHERE r.public_id = ?::uuid
                          AND r.deleted_at IS NULL
                          AND t.deleted_at IS NULL
                        """, roomId)
                .stream()
                .findFirst()
                .map(row -> roomRow(row))
                .orElseThrow(() -> notFound("상담방을 찾을 수 없습니다."));
    }

    private RoomRow roomForAdminForUpdate(String roomId) {
        requireUuid(roomId);
        return jdbcTemplate.queryForList(roomSelect() + """
                        WHERE r.public_id = ?::uuid
                          AND r.deleted_at IS NULL
                          AND t.deleted_at IS NULL
                        FOR UPDATE OF r, t
                        """, roomId)
                .stream()
                .findFirst()
                .map(row -> roomRow(row))
                .orElseThrow(() -> notFound("상담방을 찾을 수 없습니다."));
    }

    private String roomSelect() {
        return """
                SELECT r.id AS internal_id,
                       r.public_id::text AS id,
                       r.status,
                       r.title,
                       r.last_message_preview,
                       r.last_message_at,
                       r.user_unread_count,
                       r.admin_unread_count,
                       r.created_at,
                       r.updated_at,
                       t.id AS ticket_internal_id,
                       t.public_id::text AS as_ticket_id,
                       t.status AS ticket_status,
                       t.symptom AS ticket_symptom,
                       owner.public_id::text AS user_id,
                       owner.email AS user_email,
                       owner.name AS user_name,
                       admin.public_id::text AS assigned_admin_id
                FROM support_chat_rooms r
                JOIN as_tickets t ON t.id = r.as_ticket_id
                JOIN users owner ON owner.id = r.user_id
                LEFT JOIN users admin ON admin.id = t.assigned_admin_id
                """;
    }

    private void insertMessage(Long roomInternalId, String role, String content, Long senderUserId) {
        jdbcTemplate.update("""
                INSERT INTO support_chat_messages (
                  room_id,
                  role,
                  content,
                  sender_user_id
                )
                VALUES (?, ?, ?, ?)
                """, roomInternalId, role, content, senderUserId);
    }

    private Map<String, Object> existingMessage(Long senderInternalId, String clientMessageId) {
        return jdbcTemplate.queryForList("""
                        SELECT m.public_id::text AS message_id,
                               m.client_message_id::text AS client_message_id,
                               r.public_id::text AS room_id,
                               m.content,
                               m.created_at
                        FROM support_chat_messages m
                        JOIN support_chat_rooms r ON r.id = m.room_id
                        WHERE m.sender_user_id = ?
                          AND m.client_message_id = ?::uuid
                        """, senderInternalId, clientMessageId)
                .stream()
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "중복 메시지를 확인할 수 없습니다. 다시 시도해 주세요."
                ));
    }

    private void updateAfterMessage(Long roomInternalId, String content, String role) {
        int userUnreadDelta = "ADMIN".equals(role) ? 1 : 0;
        int adminUnreadDelta = "USER".equals(role) ? 1 : 0;
        jdbcTemplate.update("""
                UPDATE support_chat_rooms
                SET last_message_preview = ?,
                    last_message_at = now(),
                    user_unread_count = CASE WHEN ? = 1 THEN user_unread_count + 1 ELSE 0 END,
                    admin_unread_count = CASE WHEN ? = 1 THEN admin_unread_count + 1 ELSE 0 END,
                    updated_at = now()
                WHERE id = ?
                """, preview(content), userUnreadDelta, adminUnreadDelta, roomInternalId);
    }

    private List<Map<String, Object>> messages(Long roomInternalId) {
        return jdbcTemplate.queryForList("""
                        SELECT recent.id_text AS id,
                               recent.client_message_id,
                               recent.role,
                               recent.content,
                               recent.created_at,
                               recent.sender_id,
                               recent.sender_name
                        FROM (
                          SELECT m.id AS sort_id,
                                 m.public_id::text AS id_text,
                                 m.client_message_id::text AS client_message_id,
                                 m.role,
                                 m.content,
                                 m.created_at,
                                 sender.public_id::text AS sender_id,
                                 sender.name AS sender_name
                          FROM support_chat_messages m
                          LEFT JOIN users sender ON sender.id = m.sender_user_id
                          WHERE m.room_id = ?
                          ORDER BY m.created_at DESC, m.id DESC
                          LIMIT ?
                        ) recent
                        ORDER BY recent.created_at, recent.sort_id
                        """, roomInternalId, MESSAGE_PAGE_LIMIT)
                .stream()
                .map(row -> MockData.map(
                        "id", DbValueMapper.string(row, "id"),
                        "clientMessageId", DbValueMapper.string(row, "client_message_id"),
                        "role", DbValueMapper.string(row, "role"),
                        "content", DbValueMapper.string(row, "content"),
                        "senderId", DbValueMapper.string(row, "sender_id"),
                        "senderName", DbValueMapper.string(row, "sender_name"),
                        "createdAt", DbValueMapper.timestamp(row, "created_at")
                ))
                .toList();
    }

    private Map<String, Object> response(RoomRow room, List<Map<String, Object>> messages) {
        return MockData.map(
                "contact", contactMap(room),
                "messages", messages,
                "supportNewPath", "/support/new",
                "pollingIntervalMs", POLLING_INTERVAL_MS
        );
    }

    private Map<String, Object> empty() {
        return MockData.map(
                "contact", null,
                "messages", List.of(),
                "supportNewPath", "/support/new",
                "pollingIntervalMs", POLLING_INTERVAL_MS
        );
    }

    private Map<String, Object> contactMap(RoomRow room) {
        return MockData.map(
                "id", room.publicId(),
                "asTicketId", room.ticketPublicId(),
                "status", room.status(),
                "ticketStatus", room.ticketStatus(),
                "title", room.title(),
                "symptom", room.ticketSymptom(),
                "lastMessagePreview", room.lastMessagePreview(),
                "lastMessageAt", room.lastMessageAt(),
                "userUnreadCount", room.userUnreadCount(),
                "adminUnreadCount", room.adminUnreadCount(),
                "assignedAdminId", room.assignedAdminId(),
                "user", MockData.map(
                        "id", room.userPublicId(),
                        "email", room.userEmail(),
                        "name", room.userName()
                ),
                "visitReservation", visitReservationMap(room.ticketInternalId()),
                "canSendMessage", "ACTIVE".equals(room.status()) && !TERMINAL_TICKET_STATUSES.contains(room.ticketStatus())
        );
    }

    private RoomSummary roomSummary(RoomRow room) {
        return new RoomSummary(
                room.publicId(),
                room.ticketPublicId(),
                room.status(),
                room.ticketStatus(),
                room.title(),
                room.ticketSymptom(),
                room.lastMessagePreview(),
                room.lastMessageAt(),
                room.userUnreadCount(),
                room.adminUnreadCount(),
                room.assignedAdminId(),
                "ACTIVE".equals(room.status()) && !TERMINAL_TICKET_STATUSES.contains(room.ticketStatus()),
                new UserSummary(room.userPublicId(), room.userEmail(), room.userName())
        );
    }

    private Map<String, Object> visitReservationMap(Long ticketInternalId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
                        SELECT *
                        FROM (
                          SELECT public_id::text AS id,
                                 status,
                                 scheduled_at,
                                 address_snapshot,
                                 technician_note,
                                 created_at,
                                 updated_at
                          FROM visit_support_reservations
                          WHERE as_ticket_id = ?
                          ORDER BY CASE
                                     WHEN status IN ('REQUESTED', 'RESCHEDULE_REQUESTED', 'SCHEDULED', 'VISIT_IN_PROGRESS') THEN 0
                                     ELSE 1
                                   END,
                                   COALESCE(updated_at, created_at) DESC,
                                   id DESC
                          LIMIT 1
                        ) latest_visit_reservation
                        """, ticketInternalId);
        if (rows == null || rows.isEmpty()) {
            return null;
        }
        Map<String, Object> row = rows.get(0);
        return MockData.map(
                "id", DbValueMapper.string(row, "id"),
                "status", DbValueMapper.string(row, "status"),
                "scheduledAt", DbValueMapper.timestamp(row, "scheduled_at"),
                "addressSnapshot", DbValueMapper.string(row, "address_snapshot"),
                "technicianNote", DbValueMapper.string(row, "technician_note"),
                "createdAt", DbValueMapper.timestamp(row, "created_at"),
                "updatedAt", DbValueMapper.timestamp(row, "updated_at")
        );
    }

    private RoomRow roomRow(Map<String, Object> row) {
        return new RoomRow(
                longValue(row, "internal_id"),
                DbValueMapper.string(row, "id"),
                longValue(row, "ticket_internal_id"),
                DbValueMapper.string(row, "as_ticket_id"),
                DbValueMapper.string(row, "ticket_status"),
                DbValueMapper.string(row, "ticket_symptom"),
                DbValueMapper.string(row, "status"),
                DbValueMapper.string(row, "title"),
                DbValueMapper.string(row, "last_message_preview"),
                DbValueMapper.timestamp(row, "last_message_at"),
                intValue(row, "user_unread_count"),
                intValue(row, "admin_unread_count"),
                DbValueMapper.string(row, "user_id"),
                DbValueMapper.string(row, "user_email"),
                DbValueMapper.string(row, "user_name"),
                DbValueMapper.string(row, "assigned_admin_id")
        );
    }

    private RoomRow archivedRoom(RoomRow room, String ticketStatus) {
        return new RoomRow(
                room.internalId(),
                room.publicId(),
                room.ticketInternalId(),
                room.ticketPublicId(),
                ticketStatus,
                room.ticketSymptom(),
                "ARCHIVED",
                room.title(),
                SYSTEM_DELETE_MESSAGE,
                MockData.now(),
                room.userUnreadCount() + 1,
                room.adminUnreadCount(),
                room.userPublicId(),
                room.userEmail(),
                room.userName(),
                room.assignedAdminId()
        );
    }

    private static String requireMessage(Map<String, Object> request) {
        Object rawContent = request == null ? null : request.get("content");
        if (rawContent != null && !(rawContent instanceof String)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "메시지 내용을 문자열로 입력해 주세요.");
        }
        String content = stringOrNull(rawContent);
        if (content == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "메시지 내용을 입력해 주세요.");
        }
        if (content.length() > MAX_MESSAGE_LENGTH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "메시지는 2000자 이하로 입력해 주세요.");
        }
        return content;
    }

    private static String requireClientMessageId(String value) {
        String clientMessageId = stringOrNull(value);
        if (clientMessageId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "clientMessageId가 필요합니다.");
        }
        try {
            UUID.fromString(clientMessageId);
            return clientMessageId;
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "clientMessageId는 UUID 형식이어야 합니다.");
        }
    }

    private static void requireMessageAllowed(RoomRow room) {
        if (TERMINAL_TICKET_STATUSES.contains(room.ticketStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "종료된 AS 티켓 상담방에는 메시지를 보낼 수 없습니다.");
        }
        if (!"ACTIVE".equals(room.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "활성 상태가 아닌 상담방에는 메시지를 보낼 수 없습니다.");
        }
    }

    private static void requireUuid(String value) {
        try {
            UUID.fromString(value);
        } catch (Exception error) {
            throw notFound("상담방을 찾을 수 없습니다.");
        }
    }

    private static ResponseStatusException notFound(String message) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
    }

    private static Long longValue(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (value instanceof Number number) {
            return number.longValue();
        }
        return value == null ? null : Long.valueOf(value.toString());
    }

    private static int intValue(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (value instanceof Number number) {
            return number.intValue();
        }
        return value == null ? 0 : Integer.parseInt(value.toString());
    }

    private static String stringOrNull(Object value) {
        if (value == null) {
            return null;
        }
        String text = value.toString().trim();
        return text.isBlank() || "null".equalsIgnoreCase(text) ? null : text;
    }

    private static String preview(String content) {
        String normalized = content.replaceAll("\\s+", " ").trim();
        return normalized.length() <= 240 ? normalized : normalized.substring(0, 240);
    }

    private record TicketRef(Long internalId, String publicId, String symptom, String status) {
    }

    private record RoomRef(String publicId) {
    }

    private record RoomRow(
            Long internalId,
            String publicId,
            Long ticketInternalId,
            String ticketPublicId,
            String ticketStatus,
            String ticketSymptom,
            String status,
            String title,
            String lastMessagePreview,
            Object lastMessageAt,
            int userUnreadCount,
            int adminUnreadCount,
            String userPublicId,
            String userEmail,
            String userName,
            String assignedAdminId
    ) {
    }
}
