/**
 * templates.js
 * Static catalog of project starter templates offered in the New Project modal.
 * Exposed as a global for simplicity since this launcher has no bundler.
 */
window.RealotTemplates = [
    {
        id: 'blank',
        name: 'Blank Canvas',
        icon: 'monitor',
        description: 'An empty scene with just a camera. Start from nothing and build any 2D game you like.',
        default: true
    },
    {
        id: 'platformer',
        name: 'Platformer Kit',
        icon: 'move-diagonal',
        description: 'Side-scrolling platformer: run and jump across tile platforms with a smooth-following camera. Fall off the edge and the level restarts.',
        // Bundled real project data (js/data/templates/platformer-starter.data.js)
        // that new-project seeding applies via applySnapshot() the first
        // time this template's project is opened in the editor — see
        // editor/viewport/SceneViewport.js's loadInitialProject(). Templates
        // without a hasBundledData entry (Blank Canvas) just fall through
        // to the engine's normal blank starter scene.
        hasBundledData: true,
        // Optional banner thumbnail shown above the icon/name/description in
        // the New Project modal's template grid (see TemplateGrid.js) —
        // templates without a `thumbnail` just render the small icon tile
        // like before. 720px-wide webp (matches the project's existing
        // static-thumbnail convention, see editor/assets/script-thumb.webp).
        thumbnail: 'js/data/templates/assets/platformer-thumb.webp'
    },
    {
        id: 'topdown',
        name: 'Top-Down',
        icon: 'swords',
        description: 'Top-down starter: steer a robot with WASD or the arrow keys, collect every coin, and stay away from the red patrol robots. Touch one and it is game over.',
        // Same real-project-seeding pattern as 'platformer' above — see
        // its comment for the full explanation. Data lives in
        // js/data/templates/topdown.data.js.
        hasBundledData: true,
        thumbnail: 'js/data/templates/assets/topdown-thumb.webp'
    },
    {
        id: 'flappy-bird',
        name: 'Flappy Bird',
        icon: 'bird',
        description: 'Tap or press Space to flap through the gaps between pipes. You score a point for every pair you pass. A tiny three-script starter.',
        // Same real-project-seeding pattern as 'platformer' above — see
        // its comment for the full explanation.
        hasBundledData: true,
        thumbnail: 'js/data/templates/assets/flappy-bird-thumb.webp'
    },
    {
        id: 'sky-jumper',
        name: 'Sky Jumper',
        icon: 'cloud',
        description: 'Doodle-style climber: bounce from cloud to cloud, grab stars, and climb as high as you can. Fall off the bottom and you start over.',
        // Same real-project-seeding pattern as 'platformer' above — see
        // its comment for the full explanation. Data lives in
        // js/data/templates/sky-jumper.data.js.
        hasBundledData: true,
        thumbnail: 'js/data/templates/assets/sky-jumper-thumb.webp'
    },
    {
        id: 'physics-sandbox',
        name: 'Physics Sandbox',
        icon: 'shapes',
        description: 'A physics toy box: swing a wrecking ball into a crate pyramid, drag and fling crates, and launch them off the green pad.',
        // Same real-project-seeding pattern as 'platformer' above — see
        // its comment for the full explanation.
        hasBundledData: true,
        thumbnail: 'js/data/templates/assets/physics-sandbox-thumb.webp'
    }
];
