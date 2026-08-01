package com.buildgraph.prototype.user;

import com.buildgraph.prototype.common.DbValueMapper;
import com.buildgraph.prototype.common.MockData;
import com.buildgraph.prototype.common.ReadThroughTtlCache;
import com.nimbusds.jwt.JWTClaimsSet;
import java.time.Duration;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CurrentUserService {
    private final JdbcTemplate jdbcTemplate;
    private final JwtTokenService jwtTokenService;
    private final ReadThroughTtlCache<String, CurrentUser> userCache;

    @Autowired
    public CurrentUserService(
            JdbcTemplate jdbcTemplate,
            JwtTokenService jwtTokenService,
            @Value("${buildgraph.auth.user-cache.ttl-seconds:300}") long userCacheTtlSeconds,
            @Value("${buildgraph.auth.user-cache.jitter-seconds:60}") long userCacheJitterSeconds,
            @Value("${buildgraph.auth.user-cache.max-size:4096}") int userCacheMaxSize
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.jwtTokenService = jwtTokenService;
        this.userCache = new ReadThroughTtlCache<>(
                Duration.ofSeconds(userCacheTtlSeconds),
                Duration.ofSeconds(userCacheJitterSeconds),
                userCacheMaxSize
        );
    }

    CurrentUserService(JdbcTemplate jdbcTemplate, JwtTokenService jwtTokenService) {
        this(jdbcTemplate, jwtTokenService, 0L, 0L, 4096);
    }

    CurrentUserService(JdbcTemplate jdbcTemplate, JwtTokenService jwtTokenService, long userCacheTtlSeconds) {
        this(jdbcTemplate, jwtTokenService, userCacheTtlSeconds, 0L, 4096);
    }

    public CurrentUser requireUser(String authorization) {
        String token = bearerToken(authorization);
        JWTClaimsSet claims = verifyJwt(token);
        return userCache.get(claims.getSubject(), () -> findByPublicId(claims.getSubject()));
    }

    public String requireAuthenticatedSubject(String authorization) {
        String token = bearerToken(authorization);
        return verifyJwt(token).getSubject();
    }

    public void evictCachedUser(String publicId) {
        if (publicId != null && !publicId.isBlank()) {
            userCache.remove(publicId);
        }
    }

    public CurrentUser requireAdmin(String authorization) {
        return requireAdminUser(requireUser(authorization));
    }

    public CurrentUser requireAdminUser(CurrentUser user) {
        String freshRole = findRoleByInternalId(user.internalId());
        if (!"ADMIN".equals(freshRole)) {
            evictCachedUser(user.id());
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Admin permission is required.");
        }
        if (!"ADMIN".equals(user.role())) {
            evictCachedUser(user.id());
            return findByPublicId(user.id());
        }
        return user;
    }

    private String bearerToken(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Login is required.");
        }
        String token = authorization.substring("Bearer ".length()).trim();
        if (token.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Login is required.");
        }
        return token;
    }

    private JWTClaimsSet verifyJwt(String token) {
        try {
            return jwtTokenService.verifyAccessToken(token);
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Login is required.", exception);
        }
    }

    private CurrentUser findByPublicId(String publicId) {
        return jdbcTemplate.queryForList("""
                        SELECT id AS internal_id,
                               public_id::text AS id,
                               email,
                               name,
                               role,
                               created_at
                        FROM users
                        WHERE public_id = ?::uuid
                          AND deleted_at IS NULL
                        """, publicId)
                .stream()
                .findFirst()
                .map(this::currentUser)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found."));
    }

    private String findRoleByInternalId(Long internalId) {
        return jdbcTemplate.queryForList("""
                        SELECT role
                        FROM users
                        WHERE id = ?
                          AND deleted_at IS NULL
                        """, internalId)
                .stream()
                .findFirst()
                .map(row -> DbValueMapper.string(row, "role"))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found."));
    }

    private CurrentUser currentUser(Map<String, Object> row) {
        return new CurrentUser(
                longValue(row, "internal_id"),
                DbValueMapper.string(row, "id"),
                DbValueMapper.string(row, "email"),
                DbValueMapper.string(row, "name"),
                DbValueMapper.string(row, "role"),
                DbValueMapper.timestamp(row, "created_at")
        );
    }

    private static Long longValue(Map<String, Object> row, String key) {
        Object value = row.get(key);
        if (value instanceof Number number) {
            return number.longValue();
        }
        return value == null ? null : Long.valueOf(value.toString());
    }

    public record CurrentUser(
            Long internalId,
            String id,
            String email,
            String name,
            String role,
            Object createdAt
    ) {
        public Map<String, Object> toUserMap() {
            return MockData.map(
                    "id", id,
                    "email", email,
                    "name", name,
                    "role", role,
                    "createdAt", createdAt
            );
        }
    }
}
