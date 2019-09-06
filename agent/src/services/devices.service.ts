import {CollectionName, FirebaseRepository} from "./repositories/firebase.repository";
import {DevicesRepository} from "./repositories/devices.repository";
import {Device} from 'pandalab-commons';
import {Observable} from "rxjs";

export class DevicesService {


    constructor(private firebaseRepo: FirebaseRepository, private devicesRepo: DevicesRepository) {

    }


    listenAgentDevices(agentUID: string): Observable<Device[]> {
        let agentRef = this.firebaseRepo.getCollection(CollectionName.AGENTS).doc(agentUID);
        let query = this.firebaseRepo.getCollection(CollectionName.DEVICES)
            .where("agent", '==', agentRef);
        return this.firebaseRepo.listenQuery(query)
    }

    updateDevice(device: Device) {
        return this.firebaseRepo.saveDocument(device, true)
    }


}