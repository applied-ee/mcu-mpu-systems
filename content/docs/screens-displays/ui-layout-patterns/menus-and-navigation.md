---
title: "Menus & Navigation Patterns"
weight: 20
---

# Menus & Navigation Patterns

Once your embedded display shows more than a single static value, you need navigation — a way for users to access different screens, change settings, or trigger actions. The input devices on embedded projects (typically buttons and rotary encoders) are far more limited than a touchscreen, which makes the navigation design both more important and more constrained.

## Rotary Encoder + Button

The rotary encoder with an integrated push button is the most versatile input device for small-screen UIs. Rotation scrolls through options, and the button confirms a selection. This maps naturally to list menus: rotate to highlight an item, press to enter. For value editing, the same pattern works: press to start editing a parameter, rotate to change the value, press to confirm.

Rotary encoders generate quadrature signals on two pins, and the decoding needs debouncing — mechanical encoders are noisy. Hardware timers, pin-change interrupts with debounce logic, or a library that handles quadrature decoding are all common approaches. The encoder's "detent" positions (the clicks you feel) usually correspond to one state change per click, but some encoders produce 2 or 4 transitions per detent depending on the model. Getting this wrong means values jump by 2 or 4 per click, which is a common surprise.

## Hierarchical Menus

For projects with many settings, a tree-structured menu is the standard pattern:

```
Main Menu
├── Sensors
│   ├── Temperature
│   ├── Humidity
│   └── Pressure
├── Display
│   ├── Brightness
│   ├── Contrast
│   └── Timeout
└── System
    ├── Calibrate
    ├── Reset
    └── About
```

Navigation follows a simple state machine: rotate to scroll within a level, press to enter a submenu, and a "back" action (long-press, or a dedicated back button, or a "Back" menu item at the top of each submenu) returns to the parent. Keep the tree shallow — two levels deep is comfortable, three is the practical maximum before users get lost on a small screen without breadcrumbs.

## Selection Indicators

The user needs a clear visual indicator of which item is currently selected. Common approaches:

- **Inverted colors**: the selected item's text and background swap (white text on black becomes black on white). This is high-contrast and obvious
- **Arrow or cursor**: a `>` character or arrow icon next to the selected item. Simpler to implement than full inversion
- **Underline or bracket**: less common but works for horizontal option lists

On color displays, a colored highlight bar (e.g., blue background on the selected item) works well and looks polished.

## Input Debouncing for UI

Button debouncing is always important, but for UI navigation it has specific requirements. You want:

- **Short press detection**: single click to select or confirm (typically 50-200ms debounce)
- **Long press detection**: press and hold for back/cancel or secondary actions (typically 500-1000ms threshold)
- **Repeat-on-hold**: for encoders or buttons used to adjust values, holding should auto-repeat after an initial delay (useful for scrolling through long lists or changing numbers quickly)

Getting the timing right is subjective and depends on user testing. Defaults around 50ms debounce, 500ms long-press threshold, and 200ms repeat interval work for most people, but these are worth exposing as configurable constants.

## State Machine Approach

The cleanest way to manage menu navigation in firmware is a state machine where each state corresponds to a screen or menu level. Input events (rotate CW, rotate CCW, short press, long press) trigger transitions between states. Each state has a draw function and an input handler. This separates the UI logic from the input handling and makes it straightforward to add new screens or menu items.

Avoid deeply nested switch statements for menu logic — they get unmanageable fast. A table-driven approach (array of menu item structs with labels, child pointers, and action callbacks) scales much better.
