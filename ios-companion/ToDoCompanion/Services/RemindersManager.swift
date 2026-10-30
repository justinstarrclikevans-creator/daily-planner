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
            reminder.isCompleted = task.isCompleted
            if task.isCompleted {
                if reminder.completionDate == nil {
                    reminder.completionDate = Date()
                }
            } else {
                reminder.completionDate = nil
            }
            if let dueDate = task.dueDate {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
            } else {
                reminder.dueDateComponents = nil
            }
            
            // Sync priority (1 = High, 5 = Medium, 9 = Low)
            if task.priority.lowercased() == "high" {
                reminder.priority = 1
            } else if task.priority.lowercased() == "low" {
                reminder.priority = 9
            } else {
                reminder.priority = 5
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
    
    func fetchRecentCompletedReminders(days: Int = 30) async -> [EKReminder] {
        if !isAuthorized {
            let granted = await requestAccess()
            guard granted else { return [] }
        }
        
        let startDate = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date().addingTimeInterval(-30 * 86400)
        let predicate = eventStore.predicateForCompletedReminders(withCompletionDateStarting: startDate, ending: Date(), calendars: nil)
        
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
        let migrationKey = "did_migrate_pdf_structure_v6_clean"
        guard !UserDefaults.standard.bool(forKey: migrationKey) else { return }
        guard isAuthorized else { return }
        
        // 1. Wipe all existing reminders on device once so any bogus v5 tasks ("Bunny", etc.) are completely purged
        let allPred = eventStore.predicateForReminders(in: nil)
        let allExisting: [EKReminder] = await withCheckedContinuation { cont in
            eventStore.fetchReminders(matching: allPred) { items in
                cont.resume(returning: items ?? [])
            }
        }
        for item in allExisting {
            try? eventStore.remove(item, commit: false)
        }
        try? eventStore.commit()
        
        // 2. Ensure the 6 target lists exist and remove any deprecated lists
        let targetLists = ["General", "Turn90", "843FC", "Personal", "Nosa", "Book (Memoir) and Synapse"]
        for name in targetLists {
            _ = await createReminderList(named: name)
        }
        
        let targetSet = Set(targetLists.map { $0.lowercased() })
        for cal in eventStore.calendars(for: .reminder) {
            let lower = cal.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if !targetSet.contains(lower) {
                try? eventStore.removeCalendar(cal, commit: true)
            }
        }
        
        // 3. Seed the exact 56 tasks and subtasks from the PDF document
        let seedStructure: [(list: String, tasks: [(title: String, subtasks: [String])])] = [
            ("General", [
                ("Create a workflow for the end of the day", []),
                ("Add a failure of nerve to some of the ai engines", [])
            ]),
            ("Turn90", [
                ("Start the day", [
                    "Open Apricot",
                    "Run Main Report and export",
                    "Open T90 app",
                    "Feed report into app",
                    "Check CM and Class evaluations",
                    "Message teammates any needed feedback"
                ]),
                ("Finish the lscmi’s", []),
                ("Put in Lawrence's case plan and Notes, including job placement", []),
                ("Ask Amy about moving stuff out of the drive", []),
                ("Make an apricot report that tells me how many points everyone's earned to determine dollar amount", []),
                ("Columbia jobs", [
                    "Use the ai app to look for leads",
                    "Email and call to set appointments",
                    "Ask AI to cross check for indeed postings"
                ]),
                ("Create a feedback loop for class in case management feedback that informs training", [
                    "Look at the feedback",
                    "Download feedback",
                    "Ask ai to create needed trainings based on feedback"
                ]),
                ("Schedule time for the transfer training with Jenn", []),
                ("Reach out lashawn about VR funding and Anthony", []),
                ("Set goals for reentry navigation as a mini project under Turn 90:", [
                    "Decide whether to log goals in Apricot or T90 app",
                    "Figure out reporting and tracking methods."
                ]),
                ("Identify assessments, tracks, and job placement opportunities for SkillCat tracks.", []),
                ("Submit Walmart job applications for Arthur and Al.", []),
                ("Add daily reminder to remove people from SkillCat.morning check class and cm scores, open these websites, skillcat progress. Flag issues.", []),
                ("Define briefcase completion process and create relevant flags.", []),
                ("Create a training log to track all training sessions (planned and ad hoc) and frequency of similar conversations.", []),
                ("Provide Greg Miller (potential headhunter) with requested information.", []),
                ("Purchase appreciation gifts for program staff.", []),
                ("Use Tiimo-style checklists for program managers to track progress.", []),
                ("Explore development of an Android/Apple app for direct session recording and upload.", []),
                ("Define dashboard report requirements (e.g., weekly drug tests, case management) and automate reporting.", []),
                ("Run last year’s case notes through AI to extract insights and evaluate program effectiveness.", []),
                ("Fix employment check-in reporting in Apricot and update playbook with definitions", []),
                ("Have the algo give an updated goals list. So process is first session is setting goals, goals are listed in each next session game plan, then updates to the goals are in the case notes.", []),
                ("Write the todo brain. Ask slacks go here. Priority. Talk it out!!!", []),
                ("Look up Zune? warehouse in Orangeburg for Lawrence", []),
                ("Try to implement a feature where people can record their conversations and automatically link them to a person", []),
                ("Just focus on the playbook and everything else stems from that. Talk/write out every process", []),
                ("How are we holding case plans now?", [])
            ]),
            ("843FC", [
                ("Invites for the synapse app.", []),
                ("Christmas Initiative", [
                    "Plan out the structure",
                    "Look for products and costs",
                    "Write a one pager",
                    "Deliver to team and potential partners"
                ]),
                ("One Pager for holiday event", [
                    "Identify full list of potential partners",
                    "Go to Lloyd’s",
                    "Kasi",
                    "restaurants",
                    "Pat",
                    "Awaken church"
                ]),
                ("Switch away from fourth wall", [
                    "Change the links on 843fc.org to crowded"
                ]),
                ("Set up recurring donations", []),
                ("Launch a campaign (including app) on November 1st; 10 days remaining for preparation.", [
                    "App may not be fully ready but campaign will proceed."
                ]),
                ("Use Google to recreate \"best version\" videos from existing transcripts.", []),
                ("Email outreach to Casey Sexton, lawyers (including Brooke), and realtors:", [
                    "Pitch nonprofit advertising benefits."
                ]),
                ("Focus on campaign timing to capitalize on seasonal giving.", []),
                ("Meet with Coach Kevin to discuss:", [
                    "App development for him.",
                    "EFC Christmas shopping list.",
                    "General catch-up and collaboration."
                ]),
                ("Plan to deliver mini sermons (inspired by Rob Bell) on topics like Albertine.", []),
                ("London and Reece to help me", []),
                ("Switch 4th wall to crowded. Use 4wall for swag crowded for 5k registration", [])
            ]),
            ("Personal", [
                ("Ask antigravity to read richard rohr emails and text those instead of common prayer", []),
                ("Administer flea treatments to cats.", []),
                ("Pay Charleston water bill.", []),
                ("Order Ninja transfers for shirts (finish designs first). T90 badges as well", []),
                ("Incorporate cardio, yoga, meditation, and medication into a daily routine (using an app like Tiimo or one being developed).", []),
                ("Make a training app for the boys to enable them to charge for soccer training.", [])
            ]),
            ("Nosa", [
                ("Talk to Robert about Royvi $", []),
                ("Get Royvi picture for ID", [
                    "Finish ID",
                    "Send to Claire"
                ])
            ]),
            ("Book (Memoir) and Synapse", [
                ("Set aside dedicated time to work on the book.", []),
                ("Remember the book is a side income source with potential for further opportunities.", []),
                ("Develop an app component for passive training income/certification:", [
                    "Include CBT skills, interview skills, sales training (Sandler method), and Synapse content.",
                    "Determine if this will be part of the Free and Forward app or a separate project."
                ]),
                ("Create viral videos for Synapse using analogies (e.g., grocery store, driving your own car). Add grocery store and driving into app", []),
                ("Focus on developing the Synapse AI engine as a standalone, coachable app.", [])
            ])
        ]
        
        // Clear local task cache so only fresh tasks from the PDF structure exist
        SupabaseService.shared.tasks.removeAll()
        
        for group in seedStructure {
            for item in group.tasks {
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
        let completedReminders = await fetchRecentCompletedReminders(days: 30)
        let activeReminderIds = Set(reminders.map { $0.calendarItemIdentifier })
        
        // Remove local tasks belonging to deprecated lists
        SupabaseService.shared.tasks.removeAll { task in
            deprecatedListNames.contains(task.listName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        }
        
        // 1. Mark tasks as completed in app if completed in Apple Reminders
        for comp in completedReminders {
            guard let title = comp.title, !title.isEmpty, title != "[App Heartbeat]" else { continue }
            let compId = comp.calendarItemIdentifier
            let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            if let index = SupabaseService.shared.tasks.firstIndex(where: {
                $0.appleReminderId == compId || ($0.appleReminderId == nil && $0.title.caseInsensitiveCompare(cleanTitle) == .orderedSame)
            }) {
                if !SupabaseService.shared.tasks[index].isCompleted {
                    SupabaseService.shared.tasks[index].isCompleted = true
                    SupabaseService.shared.tasks[index].appleReminderId = compId
                }
            }
        }
        
        // 2. Mark tasks as completed in app if completed/removed in Apple Reminders
        for (idx, task) in SupabaseService.shared.tasks.enumerated() {
            if let rId = task.appleReminderId, !activeReminderIds.contains(rId), !task.isCompleted {
                SupabaseService.shared.tasks[idx].isCompleted = true
            }
        }
        
        // Build set of all completed task titles to prevent resurrection
        let completedTitles = Set(
            SupabaseService.shared.tasks.filter { $0.isCompleted }.map { $0.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            + completedReminders.compactMap { $0.title?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        )
        
        for r in reminders {
            guard let title = r.title, !title.isEmpty, title != "[App Heartbeat]" else { continue }
            let listName = r.calendar?.title ?? "General"
            if deprecatedListNames.contains(listName.lowercased()) { continue }
            let reminderId = r.calendarItemIdentifier
            let dueDate = r.dueDateComponents?.date
            let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            let cleanTitleLower = cleanTitle.lowercased()
            
            let matchedProject = SupabaseService.shared.projects.first { p in
                p.name.caseInsensitiveCompare(listName) == .orderedSame
            }
            
            if let index = SupabaseService.shared.tasks.firstIndex(where: {
                $0.appleReminderId == reminderId || ($0.appleReminderId == nil && $0.title == title && $0.listName.caseInsensitiveCompare(listName) == .orderedSame)
            }) {
                // If user already completed this task in the companion app, DO NOT resurrect it as incomplete!
                if SupabaseService.shared.tasks[index].isCompleted {
                    _ = await completeReminder(identifier: reminderId)
                    continue
                }
                
                var current = SupabaseService.shared.tasks[index]
                current.appleReminderId = reminderId
                current.title = title
                current.listName = listName
                current.projectId = matchedProject?.id
                if let due = dueDate { current.dueDate = due }
                
                // Resolve priority from reminder priority or notes
                if r.priority >= 1 && r.priority <= 4 {
                    current.priority = "high"
                } else if r.priority >= 6 && r.priority <= 9 {
                    current.priority = "low"
                } else if let notes = r.notes?.lowercased(), notes.contains("[🔥 high]") || notes.contains("priority: high") {
                    current.priority = "high"
                } else if let notes = r.notes?.lowercased(), notes.contains("[🌱 low]") || notes.contains("priority: low") {
                    current.priority = "low"
                }
                
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
                // If this reminder matches a completed task, complete it in EventKit and DO NOT create a new pending task
                if completedTitles.contains(cleanTitleLower) {
                    _ = await completeReminder(identifier: reminderId)
                    continue
                }
                
                var prio = "medium"
                if r.priority >= 1 && r.priority <= 4 {
                    prio = "high"
                } else if r.priority >= 6 && r.priority <= 9 {
                    prio = "low"
                } else if let notes = r.notes?.lowercased(), notes.contains("[🔥 high]") || notes.contains("priority: high") {
                    prio = "high"
                } else if let notes = r.notes?.lowercased(), notes.contains("[🌱 low]") || notes.contains("priority: low") {
                    prio = "low"
                }
                
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
                    priority: prio,
                    subtasks: parsedSubtasks
                )
            }
        }
        
        SupabaseService.shared.persistLocalTasks()
    }
    
    func importDeviceRemindersToSupabase() async {
        await syncDeviceReminders()
    }
}

