tell application "Reminders"
    set targetLists to {"Personal", "843", "Book", "General", "Reminders"}
    repeat with lName in targetLists
        if exists list lName then
            set rems to (reminders of list lName whose completed is true)
            repeat with rem in rems
                set completed of rem to false
            end repeat
        end if
    end repeat
end tell
