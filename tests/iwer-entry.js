// Installs an emulated WebXR AR device (Meta's IWER) with a synthetic living room, before the page loads.
import { XRDevice, metaQuest3 } from 'iwer';
import { SyntheticEnvironmentModule } from '@iwer/sem';
import room from '@iwer/sem/captures/living_room.json';
const dev = new XRDevice(metaQuest3, { stereoEnabled: false });
dev.installRuntime({ forceInstall: true });
dev.installSEM(SyntheticEnvironmentModule);
window.__xrDevice = dev;
window.__loadRoom = () => dev.sem.loadEnvironment(room);
