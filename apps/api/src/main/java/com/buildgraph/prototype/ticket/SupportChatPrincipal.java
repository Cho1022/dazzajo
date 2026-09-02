package com.buildgraph.prototype.ticket;

import com.buildgraph.prototype.user.CurrentUserService;
import java.security.Principal;
import org.springframework.security.core.Authentication;

public record SupportChatPrincipal(CurrentUserService.CurrentUser user) implements Principal {
    @Override
    public String getName() {
        return user.id();
    }

    static SupportChatPrincipal from(Principal principal) {
        if (principal instanceof Authentication authentication
                && authentication.getPrincipal() instanceof SupportChatPrincipal supportChatPrincipal) {
            return supportChatPrincipal;
        }
        if (principal instanceof SupportChatPrincipal supportChatPrincipal) {
            return supportChatPrincipal;
        }
        throw new SupportChatMessagingException(
                null,
                "SUPPORT_CHAT_UNAUTHORIZED",
                "로그인이 필요합니다.",
                false
        );
    }
}
