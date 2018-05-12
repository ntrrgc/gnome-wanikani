const WKTracker = imports.wkTracker.WKTracker;
const Mainloop = imports.mainloop;

const wkTracker = new WKTracker();
wkTracker.enableUpdates(update => {
    print(update.text)
})

Mainloop.run()