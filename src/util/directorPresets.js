// @ts-check

/**
 * @file directorPresets.js
 * Director Mode shortcut cue library.
 *
 * Responsibilities:
 * - Exports `DIRECTOR_PRESETS`: 200 distinct sitcom-style plot twists and
 *   stage directives across 5 categories (40 cues each).
 * - Exports `sampleDirectorPresets(count)`: Fisher-Yates sampling of unique
 *   cues used by the footer rail (10 random cues per mount, no repeats).
 *
 * @typedef {Object} DirectorPreset
 * @property {string} label Short chip label (unique across the library).
 * @property {string} plot Full director directive text.
 * @property {string} category Category name.
 */

// ---------------------------------------------------------------------------
// Category 1: Everyday Chaos (40 cues)
// ---------------------------------------------------------------------------
const EVERYDAY_CHAOS = [
    ["⚡ Power Cut", "A sudden power cut hits the neighborhood, plunging the room into darkness!"],
    ["💧 Burst Pipe", "A water pipe bursts under the sink and starts flooding the kitchen floor!"],
    ["🛸 Drone Crash", "A delivery drone loses power and crash-lands right on the balcony!"],
    ["🦜 Parrot Invasion", "A colorful pet parrot flies in through the open window and refuses to leave!"],
    ["🚨 Smoke Alarm", "The smoke detector starts beeping nonstop and nobody can make it stop!"],
    ["🕯️ Flicker Night", "The lights flicker and die, forcing everyone to finish the conversation by candlelight!"],
    ["🪳 Cockroach Panic", "A cockroach scuttles across the floor and throws the whole room into chaos!"],
    ["🧊 Fridge Died", "The fridge silently stops working overnight and everything inside is now at risk!"],
    ["🔧 Dripping Tap", "The dripping tap has become so maddening that nobody can focus on anything else!"],
    ["📦 Ceiling Leak", "A water stain on the ceiling suddenly grows and starts dripping onto the sofa!"],
    ["🪟 Window Slam", "A gust of wind slams every window shut at once and startles everyone!"],
    ["🐀 Mouse Sighting", "A mouse darts across the room and half the group jumps onto chairs!"],
    ["🧺 Rack Collapse", "The loaded clothes rack collapses and buries the freshly folded laundry!"],
    ["🔌 Outlet Spark", "An electrical outlet sparks violently when someone plugs in a charger!"],
    ["🧹 Broom Snap", "The broom snaps clean in half halfway through a dramatic sweeping speech!"],
    ["🍳 Burnt Dinner", "Dinner is burnt to a crisp right before the big hungry gathering!"],
    ["🪠 Clogged Drain", "The bathroom drain overflows and the house goes into damage-control mode!"],
    ["🔔 Stuck Doorbell", "The doorbell jams and rings continuously through the entire conversation!"],
    ["📺 Dead Static", "The TV shows only static minutes before the big match kicks off!"],
    ["🌀 Wobbly Fan", "The ceiling fan starts wobbling dangerously fast and everyone ducks for cover!"],
    ["❄️ AC Ice Storm", "The air conditioner starts spitting chunks of ice instead of cool air!"],
    ["🔋 Inverter Dead", "The backup battery dies mid-load-shedding and the room goes pitch black!"],
    ["🥛 Spoiled Milk", "The milk spoiled overnight, ruining the breakfast recipe for everyone!"],
    ["🐕 Stray Dog", "A friendly stray dog wanders into the house and makes itself completely at home!"],
    ["🎈 Balloon Pop", "A balloon pops inches from someone's ear at the worst possible moment!"],
    ["🧴 Perfume Spill", "The expensive perfume bottle shatters and the whole room reeks of it!"],
    ["🔨 Falling Photo", "A framed photo crookedly falls off the wall right onto the snacks!"],
    ["🧦 Missing Socks", "Every single sock in the laundry has mysteriously gone missing!"],
    ["🪞 Cracked Mirror", "The hallway mirror develops an ominous crack overnight!"],
    ["🍞 Toaster Jam", "The toaster jams and starts smoking while breakfast is in progress!"],
    ["📡 Signal Lost", "The internet drops completely seconds before an important video call!"],
    ["🪣 Roof Drip", "Rainwater finds a way through the roof and starts dripping onto the bed!"],
    ["🧯 False Fire Drill", "The fire alarm goes off with no fire anywhere, sending everyone stampeding out!"],
    ["🪑 Chair Collapse", "A chair collapses under someone mid-sentence, bruising their ego more than their back!"],
    ["🚿 Dry Shower", "The water tank runs dry halfway through a shower!"],
    ["🐸 Frog Hop", "A frog hops into the kitchen and becomes an unexpected dinner guest!"],
    ["🔥 Gas Smell", "A faint gas smell sends the entire house into a full-blown panic!"],
    ["🪟 Fallen Curtains", "The curtain rod crashes down and takes the drapes with it!"],
    ["📞 Wrong Number", "Calls from an unknown number keep coming at the worst moments!"],
    ["⚙️ Generator Down", "The generator dies in the middle of a party, cutting the music and lights!"]
];

// ---------------------------------------------------------------------------
// Category 2: Social & Comedy (40 cues)
// ---------------------------------------------------------------------------
const SOCIAL_COMEDY = [
    ["👫 Old Friend Visit", "A childhood friend nobody has seen in years shows up completely unannounced!"],
    ["🎵 Wall Thumping Music", "The neighbor's loud music thumps through the wall at full blast during an important conversation!"],
    ["📞 Hot Mic Group Call", "A group video call is accidentally left live and everything is being heard!"],
    ["📦 Mystery Package", "A mystery package arrives with no sender and no record of anyone ordering it!"],
    ["🍕 Wrong Food Order", "The food order arrives completely wrong, and it's all wildly spicy!"],
    ["🎂 Wrong-Day Party", "Guests arrive for a birthday party on the completely wrong day!"],
    ["💬 Leaked Voice Note", "A private voice note gets sent to the entire group chat by accident!"],
    ["📸 Selfie Photobomb", "A stranger photobombs the group selfie at the exact moment of the click!"],
    ["🎤 Balcony Karaoke", "An impromptu karaoke contest erupts on the balcony and the neighbors join in!"],
    ["💌 Misdirected Love Letter", "A love letter meant for someone else arrives and gets read aloud!"],
    ["🎭 Impression Night", "Someone starts doing spot-on impressions of everyone in the group!"],
    ["📋 Anonymous Complaint", "An angry anonymous note complaining about the group appears on the door!"],
    ["🎁 Recognized Regift", "A gift is opened and instantly recognized as something regifted from last year!"],
    ["🍰 Missing Last Slice", "The last slice of cake vanishes and everyone is a suspect!"],
    ["🛏️ Surprise Sleepover", "An unplanned sleepover crowds the house with surprise guests!"],
    ["📱 Pickpocketed Phone", "A phone gets pickpocketed at the market, and the thief knows every group secret!"],
    ["🤝 Fan Encounter", "A starstruck fan recognizes the group at a cafe and asks for a million photos!"],
    ["🎪 Talent Show Breakout", "A spontaneous talent show breaks out in the living room!"],
    ["🧾 Bill Disaster", "The restaurant bill arrives with wildly wrong numbers and sparks a debate!"],
    ["💃 Dance-Off", "An impromptu dance-off breaks out to settle a silly argument!"],
    ["📖 Read-Aloud Diary", "Someone accidentally reads a private diary entry out loud!"],
    ["🎀 Makeover Mishap", "A makeover session goes hilariously wrong before a big outing!"],
    ["👗 Same Outfit Day", "Everyone shows up wearing almost exactly the same outfit!"],
    ["📣 Mutating Rumor", "A tiny rumor spreads across the group and mutates into something absurd!"],
    ["🍜 Spice Challenge", "A spicy noodle challenge escalates far beyond what anyone bargained for!"],
    ["🎬 Leaked Audition Tape", "An embarrassing audition video gets shared with the whole group without consent!"],
    ["🪪 Swapped Wallets", "Two people swap wallets at dinner and nobody notices until the bill!"],
    ["💌 Half-Written Apology", "A half-written apology note is discovered, but nobody knows who it's for!"],
    ["🛒 Runaway Cart", "A shopping cart rolls away and gently bumps a parked car in the lot!"],
    ["🎂 Early Cake Smash", "The cake gets smashed into someone's face way too early in the party!"],
    ["📯 Speakerphone Prank", "A prank call is accidentally dialed on loud speakerphone!"],
    ["🤫 Spilled Surprise Plan", "Someone blurts out the secret surprise plan right in front of the guest of honor!"],
    ["🎯 Wrong-Target Egg", "An egg meant for a prank hits the completely wrong target!"],
    ["💒 Wrong Wedding Hall", "The group wanders into the wrong wedding hall and is mistaken for guests!"],
    ["🧮 Bill Split Debate", "Splitting the bill turns into a twenty-minute negotiation!"],
    ["📻 3AM Radio Blast", "The radio starts blasting at 3 AM and wakes the entire house!"],
    ["🎩 Hat Swap", "A favorite hat gets swapped for a ridiculous one without anyone noticing!"],
    ["🛗 Stuck Between Floors", "The apartment lift stops between floors with a group of strangers inside!"],
    ["🥶 Group Silent Treatment", "The whole group simultaneously stages a silent treatment over nothing!"],
    ["🎉 Confetti Misfire", "A confetti cannon fires directly into someone's face too early!"]
];

// ---------------------------------------------------------------------------
// Category 3: Adventure & Drama (40 cues)
// ---------------------------------------------------------------------------
const ADVENTURE_DRAMA = [
    ["🌧️ Monsoon Downpour", "A sudden monsoon thunderstorm floods the street and traps everyone indoors!"],
    ["🗺️ Old Treasure Map", "An old yellowed treasure map falls out of a secondhand book!"],
    ["🛵 Scooter Sputter", "The scooter engine sputters and dies in the middle of the road!"],
    ["🔋 1% Battery", "A phone hits 1% battery right when it matters most!"],
    ["⛈️ Transformer Strike", "Lightning strikes the transformer outside and the whole block goes dark!"],
    ["🌊 Flooded Street", "The main road turns into a river after an hour of heavy rain!"],
    ["🧗 Stranded on Ridge", "A casual hike turns into a stuck-on-the-ledge situation!"],
    ["🚌 Bus Breakdown", "The bus breaks down miles from home with no replacements in sight!"],
    ["🔥 Kitchen Flare-Up", "A small flare-up on the stove sends everyone scrambling for the extinguisher!"],
    ["🏃 Market Chase", "Someone is chased through the crowded market over a dropped wallet!"],
    ["🚑 Sudden Medical Scare", "A sudden medical scare sends the whole group rushing out the door!"],
    ["🌪️ Torn Roof Sheet", "Gusty winds tear the roof sheet loose and send it flying!"],
    ["⛺ Stranded at Night", "A flat tire leaves the group stranded on a dark road at night!"],
    ["🔦 Total Blackout Walk", "The group has to navigate the entire building in total darkness!"],
    ["🎭 Double-Booked Venue", "The venue is double-booked and another group is already setup inside!"],
    ["💔 Overheard Breakup", "A heated breakup conversation is accidentally overheard through the wall!"],
    ["🤝 Rival Challenge", "A rival publicly challenges the group to a contest they may not win!"],
    ["📜 Wrong-Line Signature", "The important contract gets signed on the wrong line and now it's void!"],
    ["🧊 Cold Snap Delay", "A sudden cold snap delays the big trip and derails everyone's plans!"],
    ["⏳ Race the Clock", "A frantic race against a ticking clock begins with minutes to spare!"],
    ["🗝️ Lost Only Key", "The only key to the place goes missing right before the big event!"],
    ["🎈 Runaway Balloon", "A helium balloon carrying something important floats away into the sky!"],
    ["🪂 Balcony Rescue", "Something valuable dangles off the balcony edge and needs a daring rescue!"],
    ["🚨 Noon Siren", "An unfamiliar city siren wails at noon and nobody knows what it means!"],
    ["🏗️ Scaffolding Wobble", "Loose scaffolding wobbles right along the group's usual route!"],
    ["🧭 Lost Lanes", "The group gets genuinely lost in a maze of unfamiliar lanes!"],
    ["🎢 Stalled at the Top", "A fair ride stalls at the very top of the track with riders aboard!"],
    ["🕳️ Corner Sinkhole", "A sinkhole opens up right outside the corner shop!"],
    ["🛤️ Closed Crossing", "The railway gate closes just as everyone is running late!"],
    ["🎖️ Veteran's Story", "An elderly veteran nearby shares a story that changes the mood entirely!"],
    ["💌 Sudden Farewell", "Someone receives a sudden farewell letter with no explanation!"],
    ["🥊 Public Clash", "A public argument escalates fast in front of a growing crowd!"],
    ["🔔 Midnight Ultimatum", "An ultimatum is delivered at midnight, changing everything!"],
    ["🏚️ Collapsing Wall", "An old boundary wall collapses during careless repairs!"],
    ["🌫️ Whiteout Fog", "Dense fog erases the road ahead and halts the journey!"],
    ["🪁 Kite Snag", "A runaway kite snags high on a power line above the street!"],
    ["🧭 Wild Compass", "An old compass spins wildly, igniting treasure fever in the group!"],
    ["🛣️ Wrong Exit Hour", "The wrong highway exit costs the group a full hour of travel!"],
    ["🧨 Prank Timer", "A prank countdown timer is mistaken for the real thing!"],
    ["🕊️ Trapped Pigeon", "A pigeon gets trapped on the balcony and needs a careful rescue!"]
];

// ---------------------------------------------------------------------------
// Category 4: City Life & Outings (40 cues)
// ---------------------------------------------------------------------------
const CITY_LIFE = [
    ["🎪 Street Carnival", "A colorful street carnival procession floods the street outside!"],
    ["🚇 Metro Delays", "The metro is delayed for hours and strands the whole group!"],
    ["📱 Viral Overnight", "A video of the group goes viral overnight and strangers start recognizing them!"],
    ["🏏 Broken Window Ball", "A cricket ball smashes through a nearby window mid-game!"],
    ["🛺 Auto Strike", "An auto-rickshaw strike leaves the group stranded across town!"],
    ["🎡 Sudden Funfair", "The yearly funfair opens unannounced right where they planned to walk!"],
    ["🚧 Roadwork Blockade", "Roadwork blocks the only route home and no detour is obvious!"],
    ["🛍️ Flash Sale Frenzy", "A surprise flash sale triggers full shopping mania!"],
    ["🎤 Busker Duel", "Two street buskers duel for the crowd right in front of the group!"],
    ["🍦 Ice Cream Getaway", "The ice cream cart drives away mid-order and the chase is on!"],
    ["🏙️ Rooftop Spillover", "A neighbor's rooftop party spills over into their space!"],
    ["🐕 Park Dog Show", "A dog show takes over the entire park the group planned to cross!"],
    ["🚕 Fare Argument", "An argument erupts over an outrageous taxi fare!"],
    ["🎟️ Fake Tickets", "The group is sold fake tickets to the big match!"],
    ["🌆 Skyline Sneak", "The group sneaks onto a rooftop for a forbidden skyline view!"],
    ["📸 Sidewalk Photo Shoot", "A fashion photo shoot completely blocks the sidewalk!"],
    ["🛵 Lane Sprint", "An impromptu scooter race breaks out through the narrow lanes!"],
    ["🏬 Early Lockdown", "The mall closes early and traps the group inside!"],
    ["🚂 Parade Blockade", "A parade blocks every road back home!"],
    ["🍜 Street Food Quest", "The group sets off on a quest for the city's best street food stall!"],
    ["🎭 Puppet Crowd", "A street puppet show draws a huge crowd that swallows the group whole!"],
    ["📳 Square Flash Mob", "A flash mob erupts in the square and pulls bystanders in!"],
    ["🏮 Lantern Sky", "A lantern festival lights the sky and the group stops to stare!"],
    ["🚲 Walking Tour", "A flat tire turns the ride into an unexpected walking tour!"],
    ["🏛️ Gala Sneak-In", "The group slips into a museum gala they definitely weren't invited to!"],
    ["🎃 Festival Crush", "Festival crowds swallow the group the moment they step outside!"],
    ["✈️ Board Mix-Up", "The departure board mixes up flights and sends everyone the wrong way!"],
    ["🛶 Picnic Plan B", "The picnic spot is fully booked, so plan B begins immediately!"],
    ["🚍 Last Bus Sprint", "The group sprints for the last bus of the night!"],
    ["☕ Pop-Up Cafe", "A trendy pop-up cafe appears overnight on their street!"],
    ["🎨 Chalk Art War", "A chalk art competition takes over the pavement outside!"],
    ["🛗 Elevator Stranger", "The elevator stalls between floors with a highly unusual stranger!"],
    ["🛒 Market Haggle", "A legendary haggle at the old market draws a watching crowd!"],
    ["🎶 Brass Band Recruit", "A brass band recruits the group mid-parade with instruments thrust into their hands!"],
    ["🛹 Trick Fail", "A skate trick at the park goes impressively, memorably wrong!"],
    ["🏗️ Jackhammer Drown", "Jackhammer construction drowns out the most important conversation ever!"],
    ["🔭 Rooftop Stargaze", "A rooftop stargazing plan goes sideways when clouds roll in!"],
    ["🎠 Fair Ride Stall", "A fair ride stalls at the worst possible moment!"],
    ["🚆 Wrong Platform", "The train departs from the wrong platform while everyone watches helplessly!"],
    ["🍕 Diner Sold Out", "The only late-night diner left is sold out of everything!"]
];

// ---------------------------------------------------------------------------
// Category 5: Mystery & Secrets (40 cues)
// ---------------------------------------------------------------------------
const MYSTERY_SECRETS = [
    ["📓 Hidden Diary", "A secret diary is discovered wedged under the sofa cushion!"],
    ["💾 Encrypted Drive", "An encrypted USB drive full of mysterious files is found!"],
    ["🚪 Midnight Knocking", "An eerie, rhythmic knocking sounds at the door at midnight!"],
    ["🔑 Book Key", "A small hidden key falls out of an old book's pages!"],
    ["📜 Cipher Note", "A note arrives written entirely in an unbreakable cipher!"],
    ["👤 Watched Figure", "A masked figure watches the building from across the street!"],
    ["📻 Whisper Radio", "The radio picks up a strange whisper between the stations!"],
    ["🕯️ Signaling Flicker", "The candle flickers in a deliberate pattern, like a signal!"],
    ["📦 Do Not Open", "A sealed envelope marked 'DO NOT OPEN' appears on the mat!"],
    ["🗝️ Sealed Box", "A locked box is found with no visible keyhole at all!"],
    ["📷 Seventh Person", "An old photograph shows a mysterious seventh person nobody recognizes!"],
    ["🚲 Nightly Bicycle", "An abandoned bicycle appears outside the same spot every night!"],
    ["🔍 Wet Footprints", "Wet footprints appear across the floor with no owner in sight!"],
    ["🕰️ Stopped Clock", "The wall clock has stopped at the exact same time every day!"],
    ["📞 Breathing Caller", "A silent caller rings, breathes, and hangs up again and again!"],
    ["💌 Unsigned Note", "An unsigned romantic note appears with no clue who wrote it!"],
    ["🧳 Stranger's Suitcase", "A stranger's suitcase is left at the door, and it clicks!"],
    ["🔐 Locker on a Napkin", "A locker number is scrawled on a napkin and handed over in secret!"],
    ["🌑 Wrong-Way Shadow", "A shadow moves against the light when nothing should be moving!"],
    ["🗒️ Torn Ledger Page", "A torn page from a missing ledger turns up in the mail!"],
    ["🐍 Balcony Snake", "A snake slides onto the balcony and refuses to leave!"],
    ["🎭 Anonymous Masquerade", "An invitation arrives to a fully anonymous masquerade!"],
    ["📻 Numbers Broadcast", "The radio broadcasts repeating number sequences at odd hours!"],
    ["🔔 3AM Doorbell", "The doorbell rings at 3 AM and nobody is outside!"],
    ["🕵️ Red Herring", "Every clue points convincingly to the wrong person!"],
    ["🗺️ Desk Compartment", "An old desk has a hidden compartment that was never known about!"],
    ["💍 Vanished Heirloom", "A grandmother's heirloom ring vanishes without a trace!"],
    ["🕸️ Attic Trunk", "A dust-covered trunk sealed shut is dragged out of the attic!"],
    ["📱 Ghost Reinstall", "A deleted app keeps reinstalling itself overnight!"],
    ["📖 Map in the Cover", "A hand-drawn map is found hidden inside a book's cover!"],
    ["🚪 Timed Creak", "A floorboard creaks on its own precise schedule!"],
    ["📩 Stop Digging", "A note arrives warning the group to stop digging into something!"],
    ["🧩 Missing Final Piece", "The final piece of a finished puzzle is mysteriously missing!"],
    ["🔭 Telescope Watcher", "Someone across the way is watching through a telescope!"],
    ["📜 Surprising Will", "An old will names a completely surprising heir!"],
    ["🛋️ Muffled Voices", "Muffled voices drift from a room that should be empty!"],
    ["🕯️ Wax-Sealed Letter", "A letter arrives sealed with dark red wax and no return address!"],
    ["📞 Texts for a Stranger", "Texts meant for a stranger keep arriving on the group's phone!"],
    ["🧿 Jinxed Antique", "A 'cursed' antique starts disrupting the whole house!"],
    ["📚 Secret Door", "A door is discovered hidden behind the bookshelf!"]
];

/**
 * Canonical category names across the 200-cue library.
 * @readonly
 */
export const DIRECTOR_PRESET_CATEGORIES = Object.freeze([
    "Everyday Chaos",
    "Social & Comedy",
    "Adventure & Drama",
    "City Life & Outings",
    "Mystery & Secrets"
]);

/**
 * Complete Director Mode shortcut library — 200 distinct sitcom-style plot
 * twists and stage directives (40 per category).
 * @readonly
 * @type {readonly DirectorPreset[]}
 */
export const DIRECTOR_PRESETS = Object.freeze([
    ...EVERYDAY_CHAOS.map(([label, plot]) => ({ label, plot, category: "Everyday Chaos" })),
    ...SOCIAL_COMEDY.map(([label, plot]) => ({ label, plot, category: "Social & Comedy" })),
    ...ADVENTURE_DRAMA.map(([label, plot]) => ({ label, plot, category: "Adventure & Drama" })),
    ...CITY_LIFE.map(([label, plot]) => ({ label, plot, category: "City Life & Outings" })),
    ...MYSTERY_SECRETS.map(([label, plot]) => ({ label, plot, category: "Mystery & Secrets" }))
]);

/**
 * Fisher-Yates sampling of unique presets (no repeats within a sample).
 * Used by the footer rail to show 10 random cues per mount.
 *
 * @param {number} [count=10] Number of cues to sample.
 * @returns {DirectorPreset[]} Shuffled sample of `count` distinct presets.
 */
export function sampleDirectorPresets(count = 10) {
    const pool = [...DIRECTOR_PRESETS];

    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const swap = pool[i];
        pool[i] = pool[j];
        pool[j] = swap;
    }

    const size = Math.max(1, Math.min(count, pool.length));
    return pool.slice(0, size);
}
