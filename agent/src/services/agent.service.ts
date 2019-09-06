'use strict';


import {Guid} from "guid-typescript";
import {
    BehaviorSubject,
    combineLatest,
    concat,
    ConnectableObservable,
    from,
    merge,
    Observable,
    of,
    ReplaySubject,
    Subscription,
    Timestamp,
    zip
} from "rxjs";
import {
    catchError,
    endWith,
    first,
    flatMap,
    ignoreElements,
    map,
    multicast,
    startWith,
    tap,
    timeout,
    timestamp,
    toArray
} from "rxjs/operators";
import {DeviceAdb} from "../models/adb";
import {DeviceLog, DeviceLogType} from "../models/device";
import {Device, DeviceStatus} from 'pandalab-commons';
import {CollectionName, FirebaseRepository} from "./repositories/firebase.repository";
import {AgentRepository, AgentStatus} from "./repositories/agent.repository";
import {AdbRepository} from "./repositories/adb.repository";
import {FirebaseAuthService} from "./firebaseauth.service";
import {DevicesService} from "./devices.service";
import {StoreRepository} from "./repositories/store.repository";

export class AgentService {
    private listenDevicesSub: Subscription;

    constructor(public adbRepo: AdbRepository,
                private authService: FirebaseAuthService,
                private firebaseRepo: FirebaseRepository,
                private agentRepo: AgentRepository,
                private deviceService: DevicesService,
                private storeRepo: StoreRepository) {


        this.agentRepo.agentStatus.subscribe(value => {
            switch (value) {
                case AgentStatus.CONFIGURING:
                case AgentStatus.NOT_LOGGED:
                    if (this.listenDevicesSub) {
                        this.listenDevicesSub.unsubscribe();
                        this.listenDevicesSub = null;
                    }
                    break;
                case AgentStatus.READY:
                    this.listenDevicesSub = this.listenDevices().subscribe();
                    break
            }
        })
    }


    get autoEnroll(): boolean {
        return this.storeRepo.load("auto-enroll", "true") == "true"
    }

    set autoEnroll(value: boolean) {
        this.storeRepo.save("auto-enroll", "" + value);
        //this.notifyChange()
    }

    get enableTCP(): boolean {
        return this.storeRepo.load("enableTCP", "true") == "true"
    }

    set enableTCP(value: boolean) {
        this.storeRepo.save("enableTCP", "" + value);
        //this.notifyChange()
    }


    listenAgentStatus(): Observable<AgentStatus> {
        return this.agentRepo.agentStatus
    }

    //private changeBehaviour = new BehaviorSubject("");
    private agentDevicesData: BehaviorSubject<AgentDeviceData[]> = new BehaviorSubject<AgentDeviceData[]>([]);

    public listenAgentDevices(): Observable<AgentDeviceData[]> {
        return this.agentDevicesData;
    }

    // private notifyChange() {
    //     this.changeBehaviour.next("")
    // }

    private listenDevices(): Observable<AgentDeviceData[]> {
        console.log("listenDevices started");
        let listenAdbDeviceWithUid: Observable<DeviceAdb[]> = this.adbRepo.listenAdb().pipe(
            flatMap(devices => {
                    console.log("devices", devices.length);
                    return from(devices)
                        .pipe(
                            flatMap((device: DeviceAdb) => this.getDeviceUID(device.id)
                                .pipe(
                                    catchError(() => of("")),
                                    map(value => {
                                        device.uid = value;
                                        return device
                                    })
                                )),
                            toArray()
                        )
                }
            ));
        let listenAgentDevices = this.deviceService.listenAgentDevices(this.agentRepo.UUID);


        return combineLatest([
            listenAgentDevices,
            listenAdbDeviceWithUid
        ])
            .pipe(
                map(value => <any>{firebaseDevices: value[0], adbDevices: value[1]}),
                map(result => {
                    console.log("adbDevices", result.adbDevices.length);
                    console.log("firebaseDevices", result.firebaseDevices.length);

                    const devicesData: AgentDeviceData[] = result.adbDevices.map(adbDevice => {
                        return <AgentDeviceData>{
                            actionType: this.autoEnroll ? ActionType.enroll : ActionType.none,
                            adbDevice: adbDevice
                        }
                    });
                    result.firebaseDevices.forEach(device => {
                        const deviceData = devicesData.find(a => a.adbDevice.uid === device._ref.id);
                        if (!deviceData) {
                            device.status = DeviceStatus.offline;
                            devicesData.push(
                                <AgentDeviceData>{
                                    actionType: this.enableTCP && device.ip ? ActionType.try_connect : ActionType.none,
                                    firebaseDevice: device
                                }
                            )
                        } else {
                            deviceData.firebaseDevice = device;
                            if (device.status == DeviceStatus.offline) {
                                device.status = DeviceStatus.available;
                                deviceData.actionType = ActionType.update_status;
                            } else {
                                deviceData.actionType = ActionType.none;
                            }
                        }
                    });
                    return devicesData
                }),
                map(devicesData => {
                        const currentDevicesData = this.agentDevicesData.getValue();
                        return devicesData.map((deviceData: AgentDeviceData) => {
                            let currentDeviceData = currentDevicesData.find((cData: AgentDeviceData) =>
                                (cData.adbDevice && deviceData.adbDevice && cData.adbDevice.id === deviceData.adbDevice.id) ||
                                (cData.firebaseDevice && deviceData.firebaseDevice && cData.firebaseDevice._ref.id === deviceData.firebaseDevice._ref.id)
                            );
                            if (currentDeviceData && currentDeviceData.action && !currentDeviceData.action.isStopped) {
                                return currentDeviceData;
                            } else {
                                switch (deviceData.actionType) {
                                    case ActionType.enroll:
                                        console.log("enroll device", deviceData.adbDevice.id);
                                        deviceData.action = this.startAction(this.enrollAction(deviceData.adbDevice.id));
                                        break;
                                    case ActionType.update_status:
                                        deviceData.action = this.startAction(this.updateDeviceAction(deviceData.firebaseDevice, "save device status"));
                                        break;
                                    case ActionType.try_connect:
                                        deviceData.action = this.startAction(this.tryToConnectAction(deviceData));

                                        break;
                                    case ActionType.none:

                                        break
                                }
                                return deviceData;
                            }
                        });
                    }
                ),
                tap(data => {
                    console.log("agentDevicesData count", data.length);
                    this.agentDevicesData.next(data)
                })
            );
    }

    public getAgentUUID(): string {
        return this.agentRepo.UUID;
    }


    private startAction(action: Observable<Timestamp<DeviceLog>>): BehaviorSubject<Timestamp<DeviceLog>[]> {
        const subject = new BehaviorSubject<Timestamp<DeviceLog>[]>([]);
        action.pipe(
            catchError(err => {
                console.warn("Action error", err);
                return of(<DeviceLog>{log: err, type: DeviceLogType.ERROR})
            }),
            map((log: Timestamp<DeviceLog>) => {
                let logs = subject.getValue();
                logs.push(log);
                console.log(" - action log : " + log.value.log);
                return logs;
            }))
            .subscribe(subject);
        return subject;
    }

    private tryToConnectAction(device: AgentDeviceData): Observable<Timestamp<DeviceLog>> {
        return concat(
            this.updateDeviceAction(device.firebaseDevice, "save device status"),
            this.adbRepo.connectIp(device.firebaseDevice.ip)
                .pipe(
                    startWith(<DeviceLog>{
                        log: "try to connect to ip " + device.firebaseDevice.ip,
                        type: DeviceLogType.INFO
                    }),
                    endWith(<DeviceLog>{log: "connected to device", type: DeviceLogType.INFO}),
                    catchError(err => {
                        console.warn("Can't connect to device on " + device.firebaseDevice.ip, err);
                        device.firebaseDevice.ip = "";
                        return this.updateDeviceAction(device.firebaseDevice, "Remove device ip");
                    }),
                    timestamp(),
                )
        )
    }

    private updateDeviceAction(device: Device, message: string): Observable<Timestamp<DeviceLog>> {
        return this.deviceService.updateDevice(device)
            .pipe(
                ignoreElements(),
                startWith(<DeviceLog>{log: message, type: DeviceLogType.INFO}),
                endWith(<DeviceLog>{log: "update success", type: DeviceLogType.INFO}),
                timestamp()
            )
    }

    private enrollAction(adbDeviceId: string): Observable<Timestamp<DeviceLog>> {
        const subject = new ReplaySubject<DeviceLog>();
        subject.next({log: 'Install service APK...', type: DeviceLogType.INFO});

        const enrollObs: Observable<DeviceLog> = this.adbRepo.installApk(adbDeviceId, this.agentRepo.getAgentApk())
            .pipe(
                tap(() => subject.next({log: `Retrieve device uid...`, type: DeviceLogType.INFO})),
                flatMap(() => this.getDeviceUID(adbDeviceId)),
                tap(() => subject.next({log: `Generate firebase token...`, type: DeviceLogType.INFO})),
                flatMap(uuid => this.authService.createDeviceToken(uuid)
                    .pipe(map(token => {
                        return {uuid: uuid, token: token}
                    }))),
                tap(() => subject.next({log: 'Launch of the service...', type: DeviceLogType.INFO})),
                flatMap(result => this.adbRepo.launchActivityWithToken(adbDeviceId, 'com.leroymerlin.pandalab/.home.HomeActivity', result.token, result.uuid)
                    .pipe(map(() => result))),
                tap(() => subject.next({log: 'Wait for the device in database...', type: DeviceLogType.INFO})),
                flatMap(result => this.firebaseRepo.listenDocument(CollectionName.DEVICES, result.uuid)),
                first(device => device !== null),
                ignoreElements(),
            ) as Observable<DeviceLog>;

        return merge(subject, enrollObs)
            .pipe(
                timeout(50000),
                catchError(error => of(<DeviceLog>{log: 'Error: ' + error, type: DeviceLogType.ERROR})),
                timestamp()
            )
    }


    private getDeviceUID(deviceId: string): Observable<string> {
        const transactionId = Guid.create().toString();

        const logcatObs = this.adbRepo.readAdbLogcat(deviceId, transactionId)
            .pipe(
                first(),
                timeout(5000)
            );

        const sendTransaction = this.adbRepo.launchActivityWithToken(deviceId,
            'com.leroymerlin.pandalab/.GenerateUniqueId',
            transactionId,
            this.getAgentUUID());

        return this.adbRepo.isInstalled(deviceId, 'com.leroymerlin.pandalab')
            .pipe(
                flatMap(installed => {
                    if (!installed) {
                        throw AgentError.notInstalled()
                    }
                    return zip(logcatObs, sendTransaction)
                }),
                map(values => JSON.parse(values[0]).device_id as string)
            )
    }
}

export interface AgentDeviceData {

    actionType: ActionType,
    adbDevice: DeviceAdb,
    firebaseDevice: Device,
    action: BehaviorSubject<Timestamp<DeviceLog>[]>

}


export enum ActionType {
    enroll,
    try_connect,
    update_status,
    none
}

class AgentError extends Error {

    static APP_NOT_INSTALLED: string = "App is not installed on device";


    static notInstalled() {
        return new AgentError(AgentError.APP_NOT_INSTALLED)
    }

    private constructor(public message: string) {
        super(message);
    }

}