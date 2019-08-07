import {AsyncSubject, concat, Observable, of, Timestamp} from 'rxjs';
import {catchError, first, flatMap, ignoreElements, tap, timeout, timestamp} from 'rxjs/internal/operators';
import {adbService} from './adb.service';
import {firebaseService} from "@/services/firebase.service";
import {DeviceData, DeviceLog, DeviceLogType} from "@/models/device";
import {UUID} from "@/services/remote";

class DeviceService {

    private readonly uuid: string;

    constructor() {
        this.uuid = UUID;
    }

    // getDevicePicture(): Observable<DeviceData[]> {
    //     return this.http.get<DeviceData[]>('./assets/data/devices-data-complete.json');
    // }

    searchDeviceData(devicesData: DeviceData[], phoneDevice: string, phoneModel: string): DeviceData | null {
        const data = devicesData.filter(
            (device) => {
                return device.deviceName === phoneDevice ||
                    device.deviceCode === phoneDevice ||
                    device.deviceOtherCode === phoneDevice ||
                    device.deviceName === phoneModel ||
                    device.deviceCode === phoneModel ||
                    device.deviceOtherCode === phoneModel;
            }
        );

        if (data.length > 0) {
            return data[0];
        } else {
            return null;
        }
    }

    // TODO change this function
    // 1. Récupérer l'id du téléphone et installer l'application si elle existe pas
    // 2. Créer un custom token via l'id du téléphone
    // 3. Lancer l'activité d'enrollement
    enroll(adbDeviceId: string): Observable<Timestamp<DeviceLog>> {
        return adbService.getDeviceId(adbDeviceId)
            .pipe(
                flatMap(deviceId => {
                    return concat(
                        of({log: `Generate firebase token...`, type: DeviceLogType.INFO}),
                        firebaseService.generateCustomJwtToken(`${deviceId}`)
                            .pipe(
                                flatMap(deviceToken => concat(
                                    of({
                                        log: `Firebase token generate with success...`,
                                        type: DeviceLogType.INFO
                                    }),
                                    of({log: 'Download and install service APK...', type: DeviceLogType.INFO}),
                                    adbService.installOnlineApk(adbDeviceId, "https://pandalab.page.link/qbvQ"),
                                    of({log: 'Installation complete with success', type: DeviceLogType.INFO}),
                                    of({log: 'Launch of the service...', type: DeviceLogType.INFO}),
                                    adbService.launchActivityWithToken(adbDeviceId, 'com.leroymerlin.pandalab/.home.HomeActivity', deviceToken, this.uuid),
                                    of({log: 'Launching success', type: DeviceLogType.INFO}),
                                    of({log: 'Wait for the device in database...', type: DeviceLogType.INFO}),
                                    firebaseService.listenSpecificDeviceFromFirestore(deviceId)
                                        .pipe(
                                            first(device => device != null),
                                            ignoreElements()
                                        ),
                                    of({log: `Device enroll with success !`, type: DeviceLogType.INFO})
                                )),
                                timeout<DeviceLog>(50000),
                                catchError(error => of({log: 'Error: ' + error, type: DeviceLogType.ERROR}))
                            )
                    ).pipe(
                        timestamp()
                    );
                }),
            );
    }

    // enroll(adbDeviceId: string): Observable<Timestamp<DeviceLog>> {
    //     const subject = new AsyncSubject<DeviceLog>();
    //     subject.next({
    //         log: 'Download and install service APK...',
    //         type: DeviceLogType.INFO,
    //     });
    //     const observable = adbService.installOnlineApk(adbDeviceId, "https://pandalab.page.link/qbvQ")
    //         .pipe(
    //             tap(() => {
    //                 console.log({log: 'Launch of the service...', type: DeviceLogType.INFO});
    //                 subject.next({log: 'Installation complete with success', type: DeviceLogType.INFO});
    //                 subject.next({log: 'Launch of the service...', type: DeviceLogType.INFO});
    //             }),
    //             flatMap(() => adbService.getDeviceId(adbDeviceId)),
    //             tap(() => {
    //                 subject.next({log: `Generate firebase token...`, type: DeviceLogType.INFO});
    //                 console.log({log: `Generate firebase token...`, type: DeviceLogType.INFO});
    //             }),
    //             flatMap((deviceId) => {
    //                 return firebaseService.generateCustomJwtToken(`${deviceId}`)
    //                     .pipe(
    //                         tap((deviceToken) => {
    //                             console.log({
    //                                 log: `Firebase token generate with success with token ${deviceToken}`,
    //                                 type: DeviceLogType.INFO
    //                             });
    //                             subject.next({
    //                                 log: `Firebase token generate with success with token ${deviceToken}`,
    //                                 type: DeviceLogType.INFO
    //                             });
    //                         }),
    //                         flatMap(deviceToken => adbService.launchActivityWithToken(adbDeviceId, 'com.leroymerlin.pandalab/.home.HomeActivity', deviceToken, this.uuid)),
    //                         tap(() => {
    //                             console.log({log: 'Launching success', type: DeviceLogType.INFO});
    //                             subject.next({log: 'Launching success', type: DeviceLogType.INFO});
    //                             subject.next({log: 'Wait for the device in database...', type: DeviceLogType.INFO});
    //                         }),
    //                         flatMap(() => firebaseService.listenSpecificDeviceFromFirestore(deviceId)
    //                             .pipe(
    //                                 first(device => device != null),
    //                                 ignoreElements(),
    //                             )
    //                         ),
    //                     );
    //             }),
    //             tap(() => {
    //                 console.log({log: `Device enroll with success !`, type: DeviceLogType.INFO});
    //                 subject.next({log: `Device enroll with success !`, type: DeviceLogType.INFO});
    //             }),
    //             // timeout<DeviceLog>(50000),
    //             // catchError(error => of({log: 'Error: ' + error, type: DeviceLogType.ERROR})),
    //             // timestamp()
    //         );
    //
    //     observable.subscribe();
    //     return subject.pipe(
    //         timeout<DeviceLog>(1000 * 60 * 10),
    //         catchError(error => of({log: 'Error: ' + error, type: DeviceLogType.ERROR})),
    //         timestamp()
    //     );
    // }
}

export const deviceService = new DeviceService();
