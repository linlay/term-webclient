package files

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/pkg/sftp"

	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

func resolveLocalConflictPath(targetDir, fileName string, policy model.UploadConflictPolicy) (string, error) {
	return resolveConflictPath(
		targetDir,
		fileName,
		policy,
		func(candidate string) (bool, error) {
			_, err := os.Stat(candidate)
			return err == nil, nil
		},
		filepath.Join,
		filepath.Ext,
	)
}

func resolveRemoteConflictPath(client *sftp.Client, targetDir, fileName string, policy model.UploadConflictPolicy) (string, error) {
	return resolveConflictPath(
		targetDir,
		fileName,
		policy,
		func(candidate string) (bool, error) {
			_, err := client.Stat(candidate)
			return err == nil, nil
		},
		path.Join,
		path.Ext,
	)
}

func resolveConflictPath(
	targetDir,
	fileName string,
	policy model.UploadConflictPolicy,
	existsFn func(string) (bool, error),
	joinFn func(elem ...string) string,
	extFn func(string) string,
) (string, error) {
	if policy == "" {
		policy = model.UploadConflictPolicyOverwrite
	}
	desiredPath := joinFn(targetDir, fileName)
	switch policy {
	case model.UploadConflictPolicyOverwrite:
		return desiredPath, nil
	case model.UploadConflictPolicyReject:
		exists, err := existsFn(desiredPath)
		if err != nil {
			return "", err
		}
		if exists {
			return "", util.NewStatusError(400, "file already exists", nil)
		}
		return desiredPath, nil
	case model.UploadConflictPolicyRename:
		exists, err := existsFn(desiredPath)
		if err != nil {
			return "", err
		}
		if !exists {
			return desiredPath, nil
		}
		base := strings.TrimSuffix(fileName, extFn(fileName))
		ext := extFn(fileName)
		for idx := 1; idx < 1000; idx++ {
			candidate := joinFn(targetDir, fmt.Sprintf("%s (%d)%s", base, idx, ext))
			exists, err := existsFn(candidate)
			if err != nil {
				return "", err
			}
			if !exists {
				return candidate, nil
			}
		}
	}
	return "", util.NewStatusError(400, "unable to resolve upload target", nil)
}
