tell application "Messages"
    set myChats to chats
    set msgList to {}
    repeat with c in myChats
        try
            set myMessages to (messages of c whose date > (current date) - (30 * days))
            repeat with m in myMessages
                set end of msgList to content of m
            end repeat
        end try
    end repeat
    return msgList
end tell
