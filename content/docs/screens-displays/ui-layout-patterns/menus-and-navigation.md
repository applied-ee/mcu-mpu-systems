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

## Tips

- Use a table-driven menu definition (array of structs with label, parent, action) rather than hardcoded switch statements — adding menu items becomes a data change, not a code change
- Expose timing constants (debounce, long-press threshold, repeat interval) as configurable values rather than magic numbers — they invariably need tuning during user testing
- Include a "Back" item at the top of each submenu for single-button navigation — it's more discoverable than requiring users to learn a long-press gesture

## Caveats

- **Rotary encoders vary in transitions per detent** — Some produce 1 state change per click, others 2 or 4. Getting this wrong means values jump by 2x or 4x per click. Check the encoder's datasheet or test empirically
- **Menu trees deeper than 2-3 levels frustrate users** — Without breadcrumbs or a persistent location indicator, users lose track of where they are. Flatten the structure where possible
- **Long-press timing is subjective** — 500ms feels natural to some users and sluggish to others. User testing with the actual hardware and input device is the only way to get this right

## In Practice

- A rotary encoder that skips values or moves erratically likely has a debouncing issue — mechanical encoders produce noisy signals that need filtering in hardware (RC filter on the signal lines) or software (state machine with minimum transition time)
- Menu navigation that feels "laggy" is usually caused by excessive debounce delay or by redrawing the entire screen on every input event — redraw only the changed elements
- Users who accidentally trigger actions while scrolling through menus suggest the select button's debounce or press-detection threshold is too sensitive — increase the minimum press duration slightly
