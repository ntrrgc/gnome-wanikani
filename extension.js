const St = imports.gi.St;
const Main = imports.ui.main;
const Gio = imports.gi.Gio
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const WKTracker = Me.imports.wkTracker.WKTracker;


const wkTracker = new WKTracker();

let wkLabel, button;

function _showWaniKani() {
    Gio.Subprocess.new(["gnome-open", "https://www.wanikani.com/review/"], Gio.SubprocessFlags.NONE);
}

function init() {
    button = new St.Bin({ style_class: 'panel-button',
                          reactive: true,
                          can_focus: true,
                          x_fill: true,
                          y_fill: false,
                          track_hover: true });
    wkLabel = new St.Label({ text: "WK",
                             style_class: 'wk-label' });

    button.set_child(wkLabel);
    button.connect('button-press-event', _showWaniKani);
}

function enable() {
    log("WaniKani widget enabled");
    Main.panel._rightBox.insert_child_at_index(button, 0);

    wkTracker.enableUpdates(update => {
        print(JSON.stringify(update));
        wkLabel.set_text(update.text);
        wkLabel.style_class = `wk-label ${
            update.reviewsAvailable != null && update.reviewsAvailable > 0 ? "has-reviews" : ""
        }`;
    });
}

function disable() {
    log("WaniKani widget disabled.");
    Main.panel._rightBox.remove_child(button);

    wkTracker.disableUpdates();
}
