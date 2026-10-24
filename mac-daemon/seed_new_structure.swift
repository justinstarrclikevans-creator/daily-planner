import EventKit
import Foundation

struct SeedTask {
    let title: String
    let subtasks: [String]
    init(_ title: String, _ subtasks: [String] = []) {
        self.title = title
        self.subtasks = subtasks
    }
}

struct SeedProject {
    let name: String
    let tasks: [SeedTask]
}

let seedData: [SeedProject] = [
    SeedProject(name: "General", tasks: [
        SeedTask("Create a workflow for the end of the day"),
        SeedTask("Add a failure of nerve to some of the ai engines")
    ]),
    SeedProject(name: "Turn90", tasks: [
        SeedTask("Start the day", [
            "Open Apricot",
            "Run Main Report and export",
            "Open T90 app",
            "Feed report into app",
            "Check CM and Class evaluations",
            "Message teammates any needed feedback"
        ]),
        SeedTask("Finish the lscmi’s"),
        SeedTask("Put in Lawrence's case plan and Notes, including job placement"),
        SeedTask("Ask Amy about moving stuff out of the drive"),
        SeedTask("Make an apricot report that tells me how many points everyone's earned to determine dollar amount"),
        SeedTask("Columbia jobs", [
            "Use the ai app to look for leads",
            "Email and call to set appointments",
            "Ask AI to cross check for indeed postings"
        ]),
        SeedTask("Create a feedback loop for class in case management feedback that informs training", [
            "Look at the feedback",
            "Download feedback",
            "Ask ai to create needed trainings based on feedback"
        ]),
        SeedTask("Schedule time for the transfer training with Jenn"),
        SeedTask("Reach out lashawn about VR funding and Anthony"),
        SeedTask("Set goals for reentry navigation as a mini project under Turn 90:", [
            "Decide whether to log goals in Apricot or T90 app",
            "Figure out reporting and tracking methods."
        ]),
        SeedTask("Identify assessments, tracks, and job placement opportunities for SkillCat tracks."),
        SeedTask("Submit Walmart job applications for Arthur and Al."),
        SeedTask("Add daily reminder to remove people from SkillCat.morning check class and cm scores, open these websites, skillcat progress. Flag issues."),
        SeedTask("Define briefcase completion process and create relevant flags."),
        SeedTask("Create a training log to track all training sessions (planned and ad hoc) and frequency of similar conversations."),
        SeedTask("Provide Greg Miller (potential headhunter) with requested information."),
        SeedTask("Purchase appreciation gifts for program staff."),
        SeedTask("Use Tiimo-style checklists for program managers to track progress."),
        SeedTask("Explore development of an Android/Apple app for direct session recording and upload."),
        SeedTask("Define dashboard report requirements (e.g., weekly drug tests, case management) and automate reporting."),
        SeedTask("Run last year’s case notes through AI to extract insights and evaluate program effectiveness."),
        SeedTask("Fix employment check-in reporting in Apricot and update playbook with definitions"),
        SeedTask("Have the algo give an updated goals list. So process is first session is setting goals, goals are listed in each next session game plan, then updates to the goals are in the case notes."),
        SeedTask("Write the todo brain. Ask slacks go here. Priority. Talk it out!!!"),
        SeedTask("Look up Zune? warehouse in Orangeburg for Lawrence"),
        SeedTask("Try to implement a feature where people can record their conversations and automatically link them to a person"),
        SeedTask("Just focus on the playbook and everything else stems from that. Talk/write out every process"),
        SeedTask("How are we holding case plans now?")
    ]),
    SeedProject(name: "843FC", tasks: [
        SeedTask("Invites for the synapse app."),
        SeedTask("Christmas Initiative", [
            "Plan out the structure",
            "Look for products and costs",
            "Write a one pager",
            "Deliver to team and potential partners"
        ]),
        SeedTask("One Pager for holiday event", [
            "Identify full list of potential partners",
            "Go to Lloyd’s",
            "Kasi",
            "restaurants",
            "Pat",
            "Awaken church"
        ]),
        SeedTask("Switch away from fourth wall", [
            "Change the links on 843fc.org to crowded"
        ]),
        SeedTask("Set up recurring donations"),
        SeedTask("Launch a campaign (including app) on November 1st; 10 days remaining for preparation.", [
            "App may not be fully ready but campaign will proceed."
        ]),
        SeedTask("Use Google to recreate \"best version\" videos from existing transcripts."),
        SeedTask("Email outreach to Casey Sexton, lawyers (including Brooke), and realtors:", [
            "Pitch nonprofit advertising benefits."
        ]),
        SeedTask("Focus on campaign timing to capitalize on seasonal giving."),
        SeedTask("Meet with Coach Kevin to discuss:", [
            "App development for him.",
            "EFC Christmas shopping list.",
            "General catch-up and collaboration."
        ]),
        SeedTask("Plan to deliver mini sermons (inspired by Rob Bell) on topics like Albertine."),
        SeedTask("London and Reece to help me"),
        SeedTask("Switch 4th wall to crowded. Use 4wall for swag crowded for 5k registration")
    ]),
    SeedProject(name: "Personal", tasks: [
        SeedTask("Ask antigravity to read richard rohr emails and text those instead of common prayer"),
        SeedTask("Administer flea treatments to cats."),
        SeedTask("Pay Charleston water bill."),
        SeedTask("Order Ninja transfers for shirts (finish designs first). T90 badges as well"),
        SeedTask("Incorporate cardio, yoga, meditation, and medication into a daily routine (using an app like Tiimo or one being developed)."),
        SeedTask("Make a training app for the boys to enable them to charge for soccer training.")
    ]),
    SeedProject(name: "Nosa", tasks: [
        SeedTask("Talk to Robert about Royvi $"),
        SeedTask("Get Royvi picture for ID", [
            "Finish ID",
            "Send to Claire"
        ])
    ]),
    SeedProject(name: "Book (Memoir) and Synapse", tasks: [
        SeedTask("Set aside dedicated time to work on the book."),
        SeedTask("Remember the book is a side income source with potential for further opportunities."),
        SeedTask("Develop an app component for passive training income/certification:", [
            "Include CBT skills, interview skills, sales training (Sandler method), and Synapse content.",
            "Determine if this will be part of the Free and Forward app or a separate project."
        ]),
        SeedTask("Create viral videos for Synapse using analogies (e.g., grocery store, driving your own car). Add grocery store and driving into app"),
        SeedTask("Focus on developing the Synapse AI engine as a standalone, coachable app.")
    ])
]

let store = EKEventStore()

store.requestAccess(to: .reminder) { (granted, error) in
    guard granted else {
        print("Permission denied: \(String(describing: error))")
        exit(1)
    }
    
    // 1. Delete all existing reminders (incomplete and completed) across all lists
    let allPred = store.predicateForReminders(in: nil)
    store.fetchReminders(matching: allPred) { existingReminders in
        if let existingReminders = existingReminders {
            print("Removing \(existingReminders.count) existing reminders...")
            for r in existingReminders {
                try? store.remove(r, commit: false)
            }
            try? store.commit()
        }
        
        // 2. Determine default source for reminder calendars
        let defaultSource = store.defaultCalendarForNewReminders()?.source ?? store.calendars(for: .reminder).first?.source ?? store.sources.first(where: { $0.sourceType == .calDAV || $0.sourceType == .local })
        
        guard let source = defaultSource else {
            print("No valid EKSource found for reminders.")
            exit(1)
        }
        
        let existingCals = store.calendars(for: .reminder)
        var targetCalendars: [String: EKCalendar] = [:]
        let targetNames = Set(seedData.map { $0.name })
        
        // 3. Create or reuse the new project lists first
        for proj in seedData {
            if let existing = existingCals.first(where: { $0.title == proj.name }) {
                targetCalendars[proj.name] = existing
                print("Reusing list: \(proj.name)")
            } else {
                let cal = EKCalendar(for: .reminder, eventStore: store)
                cal.title = proj.name
                cal.source = source
                do {
                    try store.saveCalendar(cal, commit: true)
                    targetCalendars[proj.name] = cal
                    print("Created list: \(proj.name)")
                } catch {
                    print("Failed to create list \(proj.name): \(error)")
                }
            }
        }
        
        // 4. Remove all old lists that are not in the new structure
        for cal in store.calendars(for: .reminder) {
            if !targetNames.contains(cal.title) {
                do {
                    try store.removeCalendar(cal, commit: true)
                    print("Deleted old list: \(cal.title)")
                } catch {
                    print("Could not delete list \(cal.title): \(error.localizedDescription)")
                }
            }
        }
        
        // 5. Populate all tasks and subtasks
        var totalCreated = 0
        for proj in seedData {
            guard let cal = targetCalendars[proj.name] else { continue }
            for task in proj.tasks {
                let rem = EKReminder(eventStore: store)
                rem.title = task.title
                rem.calendar = cal
                
                var noteLines: [String] = ["[⏱ 5m]"]
                for sub in task.subtasks {
                    noteLines.append("- [ ] \(sub)")
                }
                rem.notes = noteLines.joined(separator: "\n")
                
                do {
                    try store.save(rem, commit: false)
                    totalCreated += 1
                } catch {
                    print("Failed to save task \(task.title): \(error)")
                }
            }
        }
        
        do {
            try store.commit()
            print("Successfully seeded \(totalCreated) tasks across \(seedData.count) project lists!")
        } catch {
            print("Failed to commit reminders: \(error)")
        }
        exit(0)
    }
}

dispatchMain()
