import EventKit
import Foundation

let store = EKEventStore()

struct NewTask {
    let title: String
    let tags: [String]
    let minutes: Int
    let priority: String
    let notes: String
    let subtasks: [String]
}

store.requestAccess(to: .reminder) { granted, error in
    guard granted else {
        print("❌ Reminders access denied")
        exit(1)
    }
    
    // 1. Locate or create General calendar
    let calendars = store.calendars(for: .reminder)
    var generalCalendar = calendars.first { $0.title.caseInsensitiveCompare("General") == .orderedSame }
    
    if generalCalendar == nil {
        print("Creating 'General' calendar list...")
        let newCal = EKCalendar(for: .reminder, eventStore: store)
        newCal.title = "General"
        newCal.source = store.defaultCalendarForNewReminders()?.source ?? store.sources.first!
        try? store.saveCalendar(newCal, commit: true)
        generalCalendar = newCal
    }
    
    guard let targetGeneral = generalCalendar else {
        print("❌ Could not get or create 'General' list")
        exit(1)
    }
    
    print("🎯 Target General List: \(targetGeneral.title) (\(targetGeneral.calendarIdentifier))")
    
    // 2. Fetch all incomplete reminders
    let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
    store.fetchReminders(matching: predicate) { existingReminders in
        let existing = existingReminders ?? []
        print("\n=== STEP 1: RECLASSIFYING & MOVING EXISTING REMINDERS (\(existing.count)) ===")
        
        for r in existing {
            let oldList = r.calendar.title
            let oldTitle = r.title ?? ""
            var newTitle = oldTitle
            var tagsToAdd: [String] = []
            
            let low = oldTitle.lowercased()
            
            if low.contains("blinkist") {
                tagsToAdd = ["personal", "home", "low", "5m"]
            } else if low.contains("finish the assessments") {
                tagsToAdd = ["turn90", "personal", "15m"]
            } else if low.contains("automated lscmi interview") {
                tagsToAdd = ["lscmi", "turn90", "apricot", "15m"]
            } else if low.contains("ai case brief is generated") {
                tagsToAdd = ["lscmi", "turn90", "apricot", "15m"]
            } else if low.contains("daisy must complete the consultation form") {
                tagsToAdd = ["daisy", "turn90", "apricot", "10m"]
            } else if low.contains("kelly tillinghast") {
                tagsToAdd = ["turn90", "email", "5m"]
            } else if low.contains("daisy's eligibility screening inconsistencies") {
                tagsToAdd = ["daisy", "turn90", "high", "15m"]
                r.priority = 1 // High
            } else if low.contains("transfr training") {
                tagsToAdd = ["brandon", "turn90", "10m"]
            } else {
                // Generic fallback for any other existing reminder
                if oldList.lowercased() != "general" {
                    tagsToAdd.append(oldList.lowercased().replacingOccurrences(of: " ", with: "-"))
                }
            }
            
            // Append missing tags to title as #hashtags
            for tag in tagsToAdd {
                let hashtag = "#\(tag)"
                if !newTitle.lowercased().contains(hashtag.lowercased()) {
                    newTitle += " \(hashtag)"
                }
            }
            
            r.title = newTitle
            r.calendar = targetGeneral
            
            do {
                try store.save(r, commit: false)
                print(" ✅ Moved [\(oldList) -> General]: \(newTitle)")
            } catch {
                print(" ❌ Error updating \(oldTitle): \(error.localizedDescription)")
            }
        }
        
        do {
            try store.commit()
            print("✨ Successfully committed existing reminders moves to General!")
        } catch {
            print("❌ Failed to commit existing reminders: \(error)")
        }
        
        // 3. Insert all new reminders from the 3-page document
        print("\n=== STEP 2: ADDING NEW REMINDERS WITH PROJECT TAGS ===")
        
        let newTasks: [NewTask] = [
            // Page 1: Nigeria Campaign (#nigeria-campaign)
            NewTask(
                title: "Create flyers",
                tags: ["nigeria-campaign", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Create signups",
                tags: ["nigeria-campaign", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: ["For sponsors and participants"]
            ),
            NewTask(
                title: "Show it to Stacy before I release it",
                tags: ["nigeria-campaign", "stacy", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Email outreach to Casey Sexton, lawyers (including Brooke), and realtors",
                tags: ["nigeria-campaign", "email", "casey", "brooke", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 1: LSCMI Updates (#lscmi)
            NewTask(
                title: "Create section in main report for consultation info",
                tags: ["lscmi", "apricot", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "Main report consultation info in Apricot",
                subtasks: []
            ),
            NewTask(
                title: "Update scoring guide",
                tags: ["lscmi", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Write out step by step process",
                tags: ["lscmi", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Map out a plan with the app to figure out why so many not explicitly discussed in intake interviews and how to get better responses",
                tags: ["lscmi", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: ["Add the question to tell me about the top five people in your life who are not family"]
            ),
            
            // Page 1: Leadership L10 (#leadership-l10)
            NewTask(
                title: "Personal Best",
                tags: ["leadership-l10", "5m"],
                minutes: 5,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Professional Best",
                tags: ["leadership-l10", "daisy", "10m"],
                minutes: 10,
                priority: "medium",
                notes: "",
                subtasks: ["Daisy and I resource app"]
            ),
            NewTask(
                title: "Headlines",
                tags: ["leadership-l10", "diyoung", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: ["Diyoung a few issues", "Resource app"]
            ),
            
            // Page 1: Training app for boys (#training-app)
            NewTask(
                title: "Scheduler",
                tags: ["training-app", "843fc", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "Training app scheduler component",
                subtasks: []
            ),
            NewTask(
                title: "Chat",
                tags: ["training-app", "843fc", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "Training app chat component",
                subtasks: []
            ),
            NewTask(
                title: "Videos and tools",
                tags: ["training-app", "843fc", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "Training app videos and tools",
                subtasks: []
            ),
            
            // Page 1: Home (#home)
            NewTask(
                title: "Flea Treatment",
                tags: ["home", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Porch slates",
                tags: ["home", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Backyard",
                tags: ["home", "45m"],
                minutes: 45,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Clean out garage and attic",
                tags: ["home", "60m"],
                minutes: 60,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 1: Apricot (#apricot)
            NewTask(
                title: "Update briefcase with an NA option",
                tags: ["apricot", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Look into briefcase options to better track",
                tags: ["apricot", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 1: Programs meeting (#programs-meeting)
            NewTask(
                title: "Programs meeting",
                tags: ["programs-meeting", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 1 & 2: T90 app (#t90-app)
            NewTask(
                title: "Use voice analysis from the interview and translate into the class to identify voices",
                tags: ["t90-app", "turn90", "45m"],
                minutes: 45,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Build out conditional logic: what week are they in, what needs to happen, briefcase status, and AI feedback",
                tags: ["t90-app", "turn90", "45m"],
                minutes: 45,
                priority: "medium",
                notes: "Build out if-this-then-that statements for participant week, briefcase requirements, and AI feedback loop.",
                subtasks: []
            ),
            NewTask(
                title: "Create a workflow high and long to choose 1, then multiple small tasks",
                tags: ["t90-app", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Create better UI with individual logins to view their stuff; simplify into portal",
                tags: ["t90-app", "turn90", "45m"],
                minutes: 45,
                priority: "medium",
                notes: "Simplify! Portal type UI: What are you looking for?",
                subtasks: []
            ),
            NewTask(
                title: "Extract the books into bite sized points and skills (e.g. Failure of Nerve into bite-sized chunks)",
                tags: ["t90-app", "turn90", "book", "45m"],
                minutes: 45,
                priority: "medium",
                notes: "Turn Failure of Nerve into skills and bite-sized points.",
                subtasks: []
            ),
            NewTask(
                title: "Make intake forms to feed into AI for start dates and weekly scheduled orientations",
                tags: ["t90-app", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "Make a few forms people can fill out feeding into AI for start dates and weekly orientation counts.",
                subtasks: []
            ),
            NewTask(
                title: "Have it create an exportable criminal history",
                tags: ["t90-app", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Create the agent and skills files",
                tags: ["t90-app", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: ["Ask it to audit all of it"]
            ),
            
            // Page 2: Antigravity (#antigravity)
            NewTask(
                title: "REA",
                tags: ["antigravity", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: ["Workllm"]
            ),
            
            // Page 2: Resource navigation app (#resource-navigation)
            NewTask(
                title: "Allow name search",
                tags: ["resource-navigation", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Investigate where the searches save",
                tags: ["resource-navigation", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2: TO DO App (#todo-app)
            NewTask(
                title: "Check if Slack can test send emails and draft Slack and emails and send them",
                tags: ["todo-app", "slack", "email", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2: Matt (#matt)
            NewTask(
                title: "Talk to Matt about orientation",
                tags: ["matt", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Check in on Diyoung with Matt",
                tags: ["matt", "diyoung", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2: Jenn (#jenn)
            NewTask(
                title: "Columbia jobs with Jenn",
                tags: ["jenn", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Kwatez mental health check in",
                tags: ["jenn", "kwatez", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2: Terrance (#terrance)
            NewTask(
                title: "Check in with Terrance",
                tags: ["terrance", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2: Amy (#amy)
            NewTask(
                title: "Ask Amy about putting time off in for all the time after I takeoff for Soccer",
                tags: ["amy", "843fc", "10m"],
                minutes: 10,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Ask Amy about moving stuff out of the drive",
                tags: ["amy", "turn90", "10m"],
                minutes: 10,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2: Kat (#kat)
            NewTask(
                title: "Connect with Kat about getting with the community organizations",
                tags: ["kat", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2: Daisy (#daisy)
            NewTask(
                title: "Reentry nav case plans for stability issues with Daisy",
                tags: ["daisy", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2: TB (#tb)
            NewTask(
                title: "Isiah plan with TB",
                tags: ["tb", "isiah", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2: Nosa (#nosa)
            NewTask(
                title: "Get a team together for the tournament",
                tags: ["nosa", "843fc", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: ["Message the parents"]
            ),
            
            // Page 2: Email (#email)
            NewTask(
                title: "Reach out to LaShawn about VR funding and Anthony",
                tags: ["email", "lashawn", "anthony", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Brandon follow up",
                tags: ["email", "brandon", "turn90", "10m"],
                minutes: 10,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2: Skillcat/Trades Tracks (#skillcat)
            NewTask(
                title: "Identify assessments, tracks, and job placement opportunities for SkillCat tracks",
                tags: ["skillcat", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Explore what AI can do with the SkillCat curriculum",
                tags: ["skillcat", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            
            // Page 2 & 3: Book (#book)
            NewTask(
                title: "Set aside dedicated time to work on the book",
                tags: ["book", "45m"],
                minutes: 45,
                priority: "medium",
                notes: "Remember the book is a side income source with potential for further opportunities.",
                subtasks: []
            ),
            
            // Page 3: 843FC (#843fc)
            NewTask(
                title: "Socials: Create viral videos for Synapse using analogies and plan mini sermons",
                tags: ["843fc", "synapse", "book", "45m"],
                minutes: 45,
                priority: "medium",
                notes: "",
                subtasks: [
                    "Create viral videos for Synapse using analogies (e.g., grocery store, driving your own car). Add grocery store and driving into app",
                    "Plan to deliver mini sermons (inspired by Rob Bell) on topics like Albertine.",
                    "Run these finished video through ai to add to book"
                ]
            ),
            NewTask(
                title: "Focus on developing the Synapse AI engine as a standalone, coachable app",
                tags: ["843fc", "synapse", "60m"],
                minutes: 60,
                priority: "high",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Develop an app component for passive training income/certification",
                tags: ["843fc", "45m"],
                minutes: 45,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Switch away from Fourthwall",
                tags: ["843fc", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Set up recurring donations",
                tags: ["843fc", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Meet with Coach Kevin to discuss money, Christmas list, and SYNAPSE app",
                tags: ["843fc", "kevin", "synapse", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: [
                    "Money",
                    "Christmas list",
                    "SYNAPSE app"
                ]
            ),
            NewTask(
                title: "SYNAPSE app: Add running logs and automated journaling",
                tags: ["843fc", "synapse", "45m"],
                minutes: 45,
                priority: "medium",
                notes: "",
                subtasks: [
                    "Add things like running logs to app",
                    "More journaling (logs what they worked on that day automatically and then they journal)"
                ]
            ),
            
            // Page 3: Program Updates (#program-updates)
            NewTask(
                title: "Module 6 updates",
                tags: ["program-updates", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Adult ed for SPB in person",
                tags: ["program-updates", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "More in depth emotion regulation curriculum",
                tags: ["program-updates", "turn90", "30m"],
                minutes: 30,
                priority: "medium",
                notes: "",
                subtasks: []
            ),
            NewTask(
                title: "Orientation: Add DOB and address as part of orientation",
                tags: ["program-updates", "turn90", "15m"],
                minutes: 15,
                priority: "medium",
                notes: "",
                subtasks: ["Add in DOB and address as part of orientation"]
            ),
            NewTask(
                title: "Integrate agreement into pay pack and simplify language and process",
                tags: ["program-updates", "turn90", "20m"],
                minutes: 20,
                priority: "medium",
                notes: "",
                subtasks: ["Simplify the language and process"]
            ),
            NewTask(
                title: "Run last year’s case notes through AI to extract insights and evaluate program effectiveness",
                tags: ["program-updates", "turn90", "45m"],
                minutes: 45,
                priority: "medium",
                notes: "",
                subtasks: []
            )
        ]
        
        var addedCount = 0
        let activeTitles = Set(existing.map { ($0.title ?? "").lowercased() })
        
        for task in newTasks {
            // Build title with hashtags
            var fullTitle = task.title
            for tag in task.tags {
                let tagClean = tag.replacingOccurrences(of: "#", with: "").lowercased()
                if !fullTitle.lowercased().contains("#\(tagClean)") {
                    fullTitle += " #\(tagClean)"
                }
            }
            
            // Check if already exists to prevent duplicate
            let baseTitleLower = task.title.lowercased()
            if activeTitles.contains(where: { $0.contains(baseTitleLower) || baseTitleLower.contains($0) }) {
                print(" ⚠️ Skipping already existing task: \(task.title)")
                continue
            }
            
            // Build notes with duration & subtasks
            var noteLines: [String] = []
            noteLines.append("[⏱ \(task.minutes)m]")
            if !task.notes.isEmpty {
                noteLines.append(task.notes)
            }
            for sub in task.subtasks {
                noteLines.append("- [ ] \(sub)")
            }
            let fullNotes = noteLines.joined(separator: "\n")
            
            let reminder = EKReminder(eventStore: store)
            reminder.calendar = targetGeneral
            reminder.title = fullTitle
            reminder.notes = fullNotes
            
            if task.priority == "high" {
                reminder.priority = 1
            } else if task.priority == "low" {
                reminder.priority = 9
            } else {
                reminder.priority = 5
            }
            
            do {
                try store.save(reminder, commit: false)
                addedCount += 1
                print(" ➕ Added: \(fullTitle)")
            } catch {
                print(" ❌ Error adding \(fullTitle): \(error.localizedDescription)")
            }
        }
        
        do {
            try store.commit()
            print("\n🎉 SUCCESS: Added \(addedCount) new tasks to 'General' list!")
        } catch {
            print("\n❌ Commit failed: \(error.localizedDescription)")
        }
        
        exit(0)
    }
}

dispatchMain()
