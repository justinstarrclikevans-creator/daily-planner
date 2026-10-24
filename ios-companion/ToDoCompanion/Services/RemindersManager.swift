import Foundation
import EventKit

@MainActor
class RemindersManager: ObservableObject {
    static let shared = RemindersManager()
    
    private let eventStore = EKEventStore()
    @Published var isAuthorized: Bool = false
    
    private init() {
        checkAuthorization()
        setupEventStoreObserver()
    }
    
    private func setupEventStoreObserver() {
        NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged,
            object: eventStore,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                print("Detected Apple Reminders database change. Auto-syncing...")
                await self?.syncDeviceReminders()
            }
        }
    }
    
    func checkAuthorization() {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        isAuthorized = (status == .fullAccess || status == .authorized)
    }
    
    func requestAccess() async -> Bool {
        do {
            if #available(iOS 17.0, *) {
                let granted = try await eventStore.requestFullAccessToReminders()
                self.isAuthorized = granted
                return granted
            } else {
                let granted = try await eventStore.requestAccess(to: .reminder)
                self.isAuthorized = granted
                return granted
            }
        } catch {
            print("Failed to request Reminders access: \(error)")
            return false
        }
    }
    
    func createReminderList(named name: String) async -> Bool {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return false }
        }
        
        let existing = eventStore.calendars(for: .reminder)
        if existing.contains(where: { $0.title.caseInsensitiveCompare(name) == .orderedSame }) {
            return true
        }
        
        let newCal = EKCalendar(for: .reminder, eventStore: eventStore)
        newCal.title = name
        newCal.source = eventStore.defaultCalendarForNewReminders()?.source ?? eventStore.sources.first
        
        do {
            try eventStore.saveCalendar(newCal, commit: true)
            return true
        } catch {
            print("Failed to create reminder list \(name): \(error)")
            return false
        }
    }
    
    func addReminder(title: String, notes: String? = nil, listName: String = "Personal", dueDate: Date? = nil) async throws -> String? {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return nil }
        }
        
        let calendars = eventStore.calendars(for: .reminder)
        var targetCalendar = calendars.first { $0.title.caseInsensitiveCompare(listName) == .orderedSame }
        
        if targetCalendar == nil {
            _ = await createReminderList(named: listName)
            let updatedCalendars = eventStore.calendars(for: .reminder)
            targetCalendar = updatedCalendars.first { $0.title.caseInsensitiveCompare(listName) == .orderedSame }
        }
        
        // Fall back to default calendar if specific list doesn't exist
        if targetCalendar == nil {
            targetCalendar = eventStore.defaultCalendarForNewReminders()
        }
        
        guard let calendar = targetCalendar else {
            throw NSError(domain: "RemindersManager", code: 404, userInfo: [NSLocalizedDescriptionKey: "No reminders list found"])
        }
        
        let reminder = EKReminder(eventStore: eventStore)
        reminder.title = title
        reminder.notes = notes
        reminder.calendar = calendar
        
        if let dueDate = dueDate {
            let calendarComponent = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
            reminder.dueDateComponents = calendarComponent
        }
        
        try eventStore.save(reminder, commit: true)
        return reminder.calendarItemIdentifier
    }
    
    func updateReminder(from task: TaskItem) async {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return }
        }
        
        var targetReminder: EKReminder? = nil
        if let rId = task.appleReminderId {
            targetReminder = eventStore.calendarItem(withIdentifier: rId) as? EKReminder
        }
        
        if targetReminder == nil {
            let incomplete = await fetchIncompleteReminders()
            targetReminder = incomplete.first(where: {
                ($0.title ?? "").caseInsensitiveCompare(task.title) == .orderedSame
            })
        }
        
        if let reminder = targetReminder {
            reminder.title = task.title
            reminder.notes = task.description
            if let dueDate = task.dueDate {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
            } else {
                reminder.dueDateComponents = nil
            }
            
            // Move between lists in Apple Reminders if listName changed
            if reminder.calendar?.title.caseInsensitiveCompare(task.listName) != .orderedSame {
                _ = await createReminderList(named: task.listName)
                let calendars = eventStore.calendars(for: .reminder)
                if let newCal = calendars.first(where: { $0.title.caseInsensitiveCompare(task.listName) == .orderedSame }) {
                    reminder.calendar = newCal
                }
            }
            
            do {
                try eventStore.save(reminder, commit: true)
            } catch {
                print("Failed to update EKReminder: \(error)")
            }
        } else if !task.isCompleted {
            if let newId = try? await addReminder(
                title: task.title,
                notes: task.description,
                listName: task.listName,
                dueDate: task.dueDate
            ) {
                if let idx = SupabaseService.shared.tasks.firstIndex(where: { $0.id == task.id }) {
                    SupabaseService.shared.tasks[idx].appleReminderId = newId
                    SupabaseService.shared.persistLocalTasks()
                }
            }
        }
    }
    
    func recordAppOpenedHeartbeat() async {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return }
        }
        let predicate = eventStore.predicateForReminders(in: nil)
        let allReminders: [EKReminder] = await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders ?? [])
            }
        }
        if let heartbeat = allReminders.first(where: { $0.title == "[App Heartbeat]" }) {
            heartbeat.isCompleted = true
            heartbeat.notes = "Last opened: \(ISO8601DateFormatter().string(from: Date()))"
            try? eventStore.save(heartbeat, commit: true)
        } else if let defaultCal = eventStore.defaultCalendarForNewReminders() {
            let heartbeat = EKReminder(eventStore: eventStore)
            heartbeat.title = "[App Heartbeat]"
            heartbeat.calendar = defaultCal
            heartbeat.isCompleted = true
            heartbeat.completionDate = Date()
            heartbeat.notes = "Last opened: \(ISO8601DateFormatter().string(from: Date()))"
            try? eventStore.save(heartbeat, commit: true)
        }
    }
    
    func fetchIncompleteReminders() async -> [EKReminder] {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return [] }
        }
        
        let predicate = eventStore.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        
        return await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { reminders in
                let filtered = (reminders ?? []).filter { $0.title != "[App Heartbeat]" }
                continuation.resume(returning: filtered)
            }
        }
    }
    
    private let deprecatedListNames: Set<String> = [
        "first shift", "football", "football / 843", "albertine initiative", "reentry nav", "843"
    ]
    
    func migrateToNewPDFStructureIfNeeded() async {
        let migrationKey = "did_migrate_pdf_structure_v5"
        guard !UserDefaults.standard.bool(forKey: migrationKey) else { return }
        guard isAuthorized else { return }
        
        // 1. Ensure the 6 target lists exist
        let targetLists = ["General", "Turn90", "843FC", "Personal", "Nosa", "Book (Memoir) and Synapse"]
        for name in targetLists {
            _ = await createReminderList(named: name)
        }
        
        // 2. Remove deprecated lists & their reminders on device if any remain
        let calendars = eventStore.calendars(for: .reminder)
        for cal in calendars {
            let lower = cal.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if deprecatedListNames.contains(lower) {
                let pred = eventStore.predicateForReminders(in: [cal])
                let oldReminders: [EKReminder] = await withCheckedContinuation { cont in
                    eventStore.fetchReminders(matching: pred) { items in
                        cont.resume(returning: items ?? [])
                    }
                }
                for item in oldReminders {
                    try? eventStore.remove(item, commit: false)
                }
                try? eventStore.commit()
                try? eventStore.removeCalendar(cal, commit: true)
            }
        }
        
        // 3. Check if the 56 tasks from the PDF structure are already synced via iCloud; if not, seed missing ones
        let existingIncomplete = await fetchIncompleteReminders()
        let seedStructure: [(list: String, tasks: [(title: String, subtasks: [String])])] = [
            ("General", [
                ("Create a workflow for the end of the day", []),
                ("Add a \"failure of nerve\" concept to the AI engines", [])
            ]),
            ("Turn90", [
                ("Talk to Adam about making digital worksheets for guys to do outside of the classroom", []),
                ("Complete Turn90 assessment", []),
                ("Prepare presentation for the T90 conference in May", [
                    "Read through materials in Drive Folder",
                    "Write an outline for what I will cover in each session I am responsible for",
                    "Confirm the outline is good",
                    "Practice the sections I am responsible for"
                ]),
                ("Explore and analyze our data and run correlations", []),
                ("Make guide for using data apps", []),
                ("Show guide for using data apps to Bunny", []),
                ("Write a proposal on how we can incorporate testing the soft skills of the staff on these traits during the hiring process and ongoing staff training.", []),
                ("Meet with different centers to teach the new fidelity platform", []),
                ("Prepare the new evaluation method for replication sites", []),
                ("Review the retention data report that I made on Google Drive", []),
                ("Work on replication workbook", []),
                ("Finish adding fidelity checklist to workbook and email to Bunny", []),
                ("Complete phase 1 fidelity platform", [
                    "Test the recording using an external mic for the classroom",
                    "Fix any bugs from tests",
                    "Show the app to Bunny for approval",
                    "Prep the one-pager for meeting with each site",
                    "Give it to them to use"
                ]),
                ("Evaluate at least 1 class session and 1 case management session for Toyin", []),
                ("Look at program tracker to see where I may need to assist", []),
                ("Compare notes from Google doc and handbook to see what fits cleanly into replication handbook", []),
                ("Do annotations for cognitive scripts for Turn90 research project", []),
                ("See how long they are maintaining checklists at Columbia after starting", []),
                ("Brainstorm an observational checklist for watching someone teach a checklist (fidelity checklist)", []),
                ("Send my notes on a call with Michigan to Bunny", []),
                ("Review other curricula (5 key model, emotional regulation, the Duluth model, matrix model)", []),
                ("Follow up with Shaddai to review cognitive behavioral sessions on video", []),
                ("Assess one phone follow up with a partner site", []),
                ("Evaluate at least 1 class session and 1 case management session for Crosswell", []),
                ("Identify strong examples of active engagement in T90 classes", []),
                ("Start the day", [
                    "Open Apricot",
                    "Run Main Report and export",
                    "Open T90 app",
                    "Feed report into app",
                    "Check CM and Class evaluations",
                    "Message teammates any needed feedback"
                ]),
                ("Weekly 10s", [
                    "Check Class Video folder",
                    "Send feedback on videos via Slack"
                ]),
                ("Check how the men did in Mock interviews (Fridays)", [
                    "Go into each cohort's phase 1 spreadsheet",
                    "Look at each guy's progress and take notes",
                    "Celebrate those who have achieved a 3 and point out guys who are stuck to the T90 channel in Slack"
                ])
            ]),
            ("843FC", [
                ("Finish end of season party planning", [
                    "Reserve space at Container bar for the team",
                    "Make awards",
                    "Make matching T-shirts for team and coaches",
                    "Prep games and competition for the families",
                    "Let families know what day and time it is"
                ]),
                ("Identify different clubs for next year in the area", []),
                ("Look for courses for coaching education", []),
                ("Explore using Veo for individual player monitoring", []),
                ("Update how the cognitive roadmap shows on the player dashboard", []),
                ("Add cognitive scoring into the system", []),
                ("Add instructions for the discovery phase of the coaching roadmap", []),
                ("Rewrite the coaching syllabus to emphasize discovery and iterative problem solving", []),
                ("Plan summer tournaments and trainings", [
                    "Make team flyer",
                    "Distribute team flyer",
                    "Reserve a spot in the Charleston Summer Classic",
                    "Schedule out summer trainings",
                    "Create registration and collect registration fees"
                ]),
                ("Set up meeting for soccer coaching panel", []),
                ("Create 1-on-1 training tracking in the coaching app", []),
                ("Reach out to clubs who are losing teams next year for players", [
                    "Find clubs losing the 2015 team due to age changes",
                    "See how I can contact the families or coaches of those teams",
                    "Send team flyers"
                ]),
                ("Plan out team camp in July", [
                    "Create curriculum",
                    "Decide Dates",
                    "Decide Cost",
                    "Make Flyer",
                    "Send Flyer"
                ])
            ]),
            ("Personal", [
                ("Pick a primary care physician", []),
                ("Update public health tracking board", []),
                ("Look for small funding options in North Charleston", []),
                ("Research narrative psychology and identity transformation", []),
                ("Check details on student loan forgiveness", []),
                ("Schedule biometric screening", [])
            ]),
            ("Nosa", [
                ("Review roadmap for Nosa", []),
                ("Update the website to reflect Nosa's direction", [
                    "Check all tabs for consistent language",
                    "Check all documents and validate claims",
                    "Send website to two people to check out and ask them what they think the product is",
                    "Find three target customers and ask them what it would take to get them to try it"
                ])
            ]),
            ("Book (Memoir) and Synapse", [
                ("Review and refine the core message", []),
                ("Organize current notes and reflections", [
                    "Pull from Google Drive and other places",
                    "Put them into the book app"
                ]),
                ("Outline the structure or chapters", []),
                ("Set a regular writing schedule", []),
                ("Identify key stories or examples to include", [])
            ])
        ]
        
        for group in seedStructure {
            for item in group.tasks {
                let alreadyExists = existingIncomplete.contains { r in
                    (r.title ?? "").caseInsensitiveCompare(item.title) == .orderedSame
                }
                if !alreadyExists {
                    let subtasks = item.subtasks.map { SubtaskItem(title: $0, isCompleted: false) }
                    let notes = TaskItem.buildDescription(
                        cleanNotes: "",
                        estimatedMinutes: 5,
                        inPlayQueue: false,
                        subtasks: subtasks
                    )
                    _ = try? await addReminder(title: item.title, notes: notes, listName: group.list)
                }
            }
        }
        
        UserDefaults.standard.set(true, forKey: migrationKey)
    }
    
    func syncReminderListsToProjects() async {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return }
        }
        
        let calendars = eventStore.calendars(for: .reminder)
        for cal in calendars {
            let name = cal.title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { continue }
            if deprecatedListNames.contains(name.lowercased()) { continue }
            
            let exists = SupabaseService.shared.projects.contains { p in
                p.name.caseInsensitiveCompare(name) == .orderedSame ||
                p.slug.caseInsensitiveCompare(name) == .orderedSame
            }
            
            if !exists {
                let slug = name.lowercased()
                    .replacingOccurrences(of: " ", with: "-")
                    .replacingOccurrences(of: "[^a-z0-9-]", with: "", options: .regularExpression)
                _ = await SupabaseService.shared.createProject(
                    name: name,
                    slug: slug.isEmpty ? "project-\(Int.random(in: 100...999))" : slug,
                    color: "#3B82F6",
                    icon: "folder.fill",
                    goal: "Imported from Apple Reminders list",
                    scheduleRule: .always
                )
            }
        }
    }
    
    func completeReminder(identifier: String) async -> Bool {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return false }
        }
        guard let item = eventStore.calendarItem(withIdentifier: identifier) as? EKReminder else {
            return false
        }
        item.isCompleted = true
        item.completionDate = Date()
        do {
            try eventStore.save(item, commit: true)
            return true
        } catch {
            print("Failed to complete EKReminder on device: \(error)")
            return false
        }
    }
    
    func syncDeviceReminders() async {
        if !isAuthorized {
            _ = await requestAccess()
        }
        guard isAuthorized else { return }
        
        await migrateToNewPDFStructureIfNeeded()
        await syncReminderListsToProjects()
        let reminders = await fetchIncompleteReminders()
        let activeReminderIds = Set(reminders.map { $0.calendarItemIdentifier })
        
        // Remove local tasks belonging to deprecated lists
        SupabaseService.shared.tasks.removeAll { task in
            deprecatedListNames.contains(task.listName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        }
        
        for r in reminders {
            guard let title = r.title, !title.isEmpty, title != "[App Heartbeat]" else { continue }
            let listName = r.calendar?.title ?? "General"
            if deprecatedListNames.contains(listName.lowercased()) { continue }
            let reminderId = r.calendarItemIdentifier
            let dueDate = r.dueDateComponents?.date
            
            let matchedProject = SupabaseService.shared.projects.first { p in
                p.name.caseInsensitiveCompare(listName) == .orderedSame
            }
            
            if let index = SupabaseService.shared.tasks.firstIndex(where: {
                $0.appleReminderId == reminderId || ($0.appleReminderId == nil && $0.title == title && $0.listName.caseInsensitiveCompare(listName) == .orderedSame)
            }) {
                var current = SupabaseService.shared.tasks[index]
                current.appleReminderId = reminderId
                current.title = title
                current.listName = listName
                current.projectId = matchedProject?.id
                if let due = dueDate { current.dueDate = due }
                if let notes = r.notes, !notes.isEmpty {
                    current.description = notes
                    if let mins = TaskItem.extractEstimatedMinutes(from: notes) {
                        current.estimatedMinutes = mins
                    } else if current.estimatedMinutes <= 0 {
                        current.estimatedMinutes = 5
                    }
                    let subtasks = TaskItem.extractSubtasks(from: notes)
                    if !subtasks.isEmpty {
                        current.subtasks = subtasks
                    }
                } else if current.estimatedMinutes <= 0 {
                    current.estimatedMinutes = 5
                }
                SupabaseService.shared.tasks[index] = current
            } else {
                let mins = TaskItem.extractEstimatedMinutes(from: r.notes ?? "") ?? 5
                let parsedSubtasks = TaskItem.extractSubtasks(from: r.notes ?? "")
                await SupabaseService.shared.createTask(
                    title: title,
                    description: r.notes,
                    listName: listName,
                    projectId: matchedProject?.id,
                    dueDate: dueDate,
                    appleReminderId: reminderId,
                    estimatedMinutes: mins,
                    subtasks: parsedSubtasks
                )
            }
        }
        
        // Mark tasks as completed in app if completed/removed in Apple Reminders
        for (idx, task) in SupabaseService.shared.tasks.enumerated() {
            if let rId = task.appleReminderId, !activeReminderIds.contains(rId), !task.isCompleted {
                SupabaseService.shared.tasks[idx].isCompleted = true
            }
        }
        
        SupabaseService.shared.persistLocalTasks()
    }
    
    func importDeviceRemindersToSupabase() async {
        await syncDeviceReminders()
    }
}

